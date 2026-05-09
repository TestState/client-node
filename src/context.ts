import {create, MessageInitShape} from "@bufbuild/protobuf";
import {WritableIterable} from "@connectrpc/connect/protocol";
import {
    Capability,
    CapabilitySchema,
    Severity,
    TelemetrySchema,
    TestCapability, TestCapabilitySchema,
    TestInit, TestResponse, TestResponseSchema, TestResultSchema, TestStatusSchema,
    TranslationCapability, TranslationCapabilitySchema,
    TranslationInit, TranslationResponse, TranslationResponseSchema, TranslationResultSchema, TranslationStatusSchema
} from "./generated/index.js";
import {timestampNow} from "./utils.js";

/**
 * Base for all specialized processors.
 */
export interface BaseProcessor {
    getCapability(): Capability;
}

/**
 * Interface for test execution logic.
 */
export interface TestSessionProcessor extends BaseProcessor {
    process(sessionId: string, context: TestSessionContext): Promise<void>;
}

/**
 * Interface for script translation logic.
 */
export interface TranslationSessionProcessor extends BaseProcessor {
    process(sessionId: string, context: TranslationSessionContext): Promise<void>;
}

// Keep the internal types for the Agent to use
export type ProcessorType = "test" | "translation";
export type AnyProcessor = TestSessionProcessor | TranslationSessionProcessor;

/**
 * Common high-level operations for any active test/translation session.
 */
export abstract class SessionContext<TInit, TResponse> {
    constructor(
        public readonly init: TInit,
        protected readonly responseIterable: WritableIterable<TResponse>
    ) {
    }
}

/**
 * Domain-specific context for Test sessions.
 */
export class TestSessionContext extends SessionContext<TestInit, TestResponse> {
    public async sendStatus(status: MessageInitShape<typeof TestStatusSchema>) {
        await this.responseIterable.write(create(TestResponseSchema, {
            timestamp: timestampNow(),
            event: {case: "status", value: create(TestStatusSchema, status)}
        }));
    }

    public async sendTelemetry(message: string, severity = Severity.INFO) {
        await this.responseIterable.write(create(TestResponseSchema, {
            timestamp: timestampNow(),
            event: {
                case: "telemetry",
                value: create(TelemetrySchema, {
                    message,
                    timestamp: timestampNow(),
                    severity,
                    source: "agent"
                })
            }
        }));
    }

    public async sendResult(result: MessageInitShape<typeof TestResultSchema>) {
        await this.responseIterable.write(create(TestResponseSchema, {
            timestamp: timestampNow(),
            event: {case: "result", value: create(TestResultSchema, result)}
        }));
    }
}

/**
 * Domain-specific context for Translation sessions.
 */
export class TranslationSessionContext extends SessionContext<TranslationInit, TranslationResponse> {
    public async sendStatus(status: MessageInitShape<typeof TranslationStatusSchema>) {
        await this.responseIterable.write(create(TranslationResponseSchema, {
            timestamp: timestampNow(),
            event: {case: "status", value: create(TranslationStatusSchema, status)}
        }));
    }

    public async sendTelemetry(message: string, severity = Severity.INFO) {
        await this.responseIterable.write(create(TranslationResponseSchema, {
            timestamp: timestampNow(),
            event: {
                case: "telemetry",
                value: create(TelemetrySchema, {
                    message,
                    timestamp: timestampNow(),
                    severity,
                    source: "translator"
                })
            }
        }));
    }

    public async sendResult(result: MessageInitShape<typeof TranslationResultSchema>) {
        await this.responseIterable.write(create(TranslationResponseSchema, {
            timestamp: timestampNow(),
            event: {case: "result", value: create(TranslationResultSchema, result)}
        }));
    }
}

/**
 * Helper to wrap a TestCapability into a Capability message.
 */
export function testCapability(value: MessageInitShape<typeof TestCapabilitySchema>): Capability {
    return create(CapabilitySchema, {
        format: {
            case: "test",
            value: create(TestCapabilitySchema, value)
        }
    });
}

/**
 * Helper to wrap a TranslationCapability into a Capability message.
 */
export function translationCapability(value: MessageInitShape<typeof TranslationCapabilitySchema>): Capability {
    return create(CapabilitySchema, {
        format: {
            case: "translation",
            value: create(TranslationCapabilitySchema, value)
        }
    });
}

