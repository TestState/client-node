import {create} from "@bufbuild/protobuf";
import {DurationSchema, TimestampSchema} from "@bufbuild/protobuf/wkt";

/**
 * Converts milliseconds to google.protobuf.DurationSchema.
 */
export function msToDuration(ms: number) {
    return create(DurationSchema, {
        seconds: BigInt(Math.floor(ms / 1000)),
        nanos: (ms % 1000) * 1000000,
    });
}

/**
 * Creates a google.protobuf.TimestampSchema from the current time.
 */
export function timestampNow() {
    return timestampFromDate(new Date());
}

/**
 * Converts a Date to google.protobuf.TimestampSchema.
 */
export function timestampFromDate(date: Date) {
    const ms = date.getTime();
    return create(TimestampSchema, {
        seconds: BigInt(Math.floor(ms / 1000)),
        nanos: (ms % 1000) * 1000000,
    });
}

/**
 * Deeply cleans an object by removing null or undefined fields.
 * Always returns a valid object (Record<string, any>), defaulting to {} if empty.
 */
export function cleanObject(obj: any): Record<string, any> {
    const clean = (val: any): any => {
        if (val === null || val === undefined) return undefined;
        if (typeof val !== 'object') return val;
        if (Array.isArray(val)) {
            const arr = val.map(v => clean(v)).filter(v => v !== undefined);
            return arr.length > 0 ? arr : undefined;
        }
        const res: any = {};
        let hasValue = false;
        for (const [k, v] of Object.entries(val)) {
            const cleaned = clean(v);
            if (cleaned !== undefined) {
                res[k] = cleaned;
                hasValue = true;
            }
        }
        return hasValue ? res : undefined;
    };

    const result = clean(obj);
    if (typeof result === 'object' && !Array.isArray(result) && result !== null) {
        return result;
    }
    return {};
}
