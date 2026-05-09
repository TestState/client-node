import {createGrpcTransport} from "@connectrpc/connect-node";
import {Client, createClient, Transport} from "@connectrpc/connect";
import {create} from "@bufbuild/protobuf";
import {createWritableIterable} from "@connectrpc/connect/protocol";
import {AgentHub, AgentRegistrationSchema, ListenRequest, ListenRequestSchema, SummarySchema, TestResponse, TestResultSchema, TestState, TestStatusSchema, TranslationResponse, TranslationResultSchema, TranslationState, TranslationStatusSchema} from "./generated/index.js";
import {AnyProcessor, ProcessorType, TestSessionProcessor, TranslationSessionProcessor, TestSessionContext, TranslationSessionContext} from "./context.js";

export interface AgentConfig {
    hubUrl: string;
    displayName: string;
}

export class Agent {
    private readonly transport: Transport;
    private readonly agentClient: Client<typeof AgentHub>;
    private readonly processors: AnyProcessor[] = [];
    private isShuttingDown = false;

    constructor(private readonly config: AgentConfig) {
        this.transport = createGrpcTransport({
            baseUrl: config.hubUrl,
        });
        this.agentClient = createClient(AgentHub, this.transport);
    }

    public registerTestProcessor(processor: TestSessionProcessor) {
        this.processors.push(processor);
    }

    public registerTranslationProcessor(processor: TranslationSessionProcessor) {
        this.processors.push(processor);
    }

    public async start() {
        console.log(`[Agent] Ready: ${this.config.displayName} (${this.processors.length} processors)`);

        while (!this.isShuttingDown) {
            try {
                await this.runLifecycle();
            } catch (err) {
                if (this.isShuttingDown) break;
                console.error("[Agent][Fatal] Disconnected. Retrying in 5s...", err);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    public shutdown() {
        this.isShuttingDown = true;
    }

    private async runLifecycle() {
        // 1. Identification & Capability Registration
        const registration = await this.agentClient.register(create(AgentRegistrationSchema, {
            displayName: this.config.displayName,
            capabilities: this.processors.map(p => p.getCapability()),
        }));

        const clientId = registration.clientId;
        console.log(`[Agent] Connected as ${registration.clientId}`);

        // 2. Control Stream Dispatcher
        const requestIterable = createWritableIterable<ListenRequest>();
        const pendingSessions = new Map<string, AnyProcessor>();
        const listenStream = this.agentClient.listen(requestIterable, {
            headers: {"x-client-id": clientId}
        });
        await requestIterable.write(create(ListenRequestSchema, {event: {case: "ready", value: {}}}));

        for await (const response of listenStream) {
            const event = response.event;

            if (event?.case === "sessionProposal") {
                const proposal = event.value;
                const category = proposal.details.case as ProcessorType;
                const typeIdentifier = (proposal.details.value as any).type as string;

                console.log(`[Agent][${category}] Handling Proposal: ${proposal.sessionId} (${typeIdentifier})`);

                const processor = this.processors.find(p => {
                    const cap = p.getCapability();
                    return cap.format.case === category && (cap.format.value as any).type === typeIdentifier;
                });

                if (processor) {
                    pendingSessions.set(proposal.sessionId, processor);
                    await requestIterable.write(create(ListenRequestSchema, {
                        event: {
                            case: "sessionAcceptance",
                            value: {sessionId: proposal.sessionId, accepted: true}
                        }
                    }));
                } else {
                    console.warn(`[Agent][${category}] Rejecting: No processor registered for type: ${typeIdentifier}`);
                    await requestIterable.write(create(ListenRequestSchema, {
                        event: {
                            case: "sessionAcceptance",
                            value: {sessionId: proposal.sessionId, accepted: false}
                        }
                    }));
                }
            } else if (event?.case === "sessionReady") {
                const sessionId = event.value.sessionId;
                const processor = pendingSessions.get(sessionId);

                if (processor) {
                    pendingSessions.delete(sessionId);
                    this.handleSessionReady(sessionId, processor).catch(err => {
                        console.error(`[Agent] Session Handling Error (${sessionId}):`, err);
                    });
                }
            }
        }
    }

    private async handleSessionReady(sessionId: string, processor: AnyProcessor) {
        const capability = processor.getCapability();
        
        if (capability.format.case === "test") {
            const testProcessor = processor as TestSessionProcessor;
            const responseIterable = createWritableIterable<TestResponse>();
            const stream = this.agentClient.execute(responseIterable, {
                headers: {"x-session-id": sessionId},
            });

            console.log(`[Agent][Test] Active: ${sessionId}`);

            const streamIterator = stream[Symbol.asyncIterator]();
            const { value: initMsg, done } = await streamIterator.next();

            if (done || !initMsg) throw new Error("Stream closed before TestInit was received.");

            const context = new TestSessionContext(initMsg, responseIterable);
            try {
                await testProcessor.process(sessionId, context);
            } catch (err: any) {
                await context.sendResult(create(TestResultSchema, {
                    status: create(TestStatusSchema, {
                        state: TestState.FAILED,
                        message: `Internal Agent Error: ${err.message || String(err)}`
                    }),
                    summary: create(SummarySchema, {
                        metadata: {
                            exception: String(err),
                            stack: err.stack || "No stack trace available"
                        }
                    })
                }));
                throw err;
            } finally {
                responseIterable.close();
            }
        } else if (capability.format.case === "translation") {
            const translationProcessor = processor as TranslationSessionProcessor;
            const responseIterable = createWritableIterable<TranslationResponse>();
            const stream = this.agentClient.translate(responseIterable, {
                headers: {"x-session-id": sessionId},
            });

            console.log(`[Agent][Translation] Active: ${sessionId}`);

            const streamIterator = stream[Symbol.asyncIterator]();
            const { value: initMsg, done } = await streamIterator.next();

            if (done || !initMsg) throw new Error("Stream closed before TranslationInit was received.");

            const context = new TranslationSessionContext(initMsg, responseIterable);
            try {
                await translationProcessor.process(sessionId, context);
            } catch (err: any) {
                await context.sendResult(create(TranslationResultSchema, {
                    status: create(TranslationStatusSchema, {
                        state: TranslationState.FAILED,
                        message: `Internal Agent Error: ${err.message || String(err)}`
                    }),
                    summary: create(SummarySchema, {
                        metadata: {
                            exception: String(err),
                            stack: err.stack || "No stack trace available"
                        }
                    })
                }));
                throw err;
            } finally {
                responseIterable.close();
            }
        }
    }
}
