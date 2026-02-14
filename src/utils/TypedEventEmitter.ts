import { EventEmitter } from "events";

type Listener = (...args: unknown[]) => void;
type EventKey<TEvents> = Extract<keyof TEvents, string | symbol>;
type EventListener<TEvents, TKey extends EventKey<TEvents>> = TEvents[TKey] extends Listener
    ? TEvents[TKey]
    : never;
type EventArgs<TEvents, TKey extends EventKey<TEvents>> = TEvents[TKey] extends Listener
    ? Parameters<TEvents[TKey]>
    : never;

export class TypedEventEmitter<TEvents extends object> extends EventEmitter {
    addListener<K extends EventKey<TEvents>>(event: K, listener: EventListener<TEvents, K>): this;
    addListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
    addListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.addListener(eventName, listener);
    }

    on<K extends EventKey<TEvents>>(event: K, listener: EventListener<TEvents, K>): this;
    on(eventName: string | symbol, listener: (...args: any[]) => void): this;
    on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(eventName, listener);
    }

    once<K extends EventKey<TEvents>>(event: K, listener: EventListener<TEvents, K>): this;
    once(eventName: string | symbol, listener: (...args: any[]) => void): this;
    once(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.once(eventName, listener);
    }

    prependListener<K extends EventKey<TEvents>>(
        event: K,
        listener: EventListener<TEvents, K>
    ): this;
    prependListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
    prependListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.prependListener(eventName, listener);
    }

    prependOnceListener<K extends EventKey<TEvents>>(
        event: K,
        listener: EventListener<TEvents, K>
    ): this;
    prependOnceListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
    prependOnceListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.prependOnceListener(eventName, listener);
    }

    off<K extends EventKey<TEvents>>(event: K, listener: EventListener<TEvents, K>): this;
    off(eventName: string | symbol, listener: (...args: any[]) => void): this;
    off(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.off(eventName, listener);
    }

    removeListener<K extends EventKey<TEvents>>(
        event: K,
        listener: EventListener<TEvents, K>
    ): this;
    removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
    removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.removeListener(eventName, listener);
    }

    removeAllListeners<K extends EventKey<TEvents>>(event?: K): this;
    removeAllListeners(eventName?: string | symbol): this;
    removeAllListeners(eventName?: string | symbol): this {
        return super.removeAllListeners(eventName);
    }

    emit<K extends EventKey<TEvents>>(event: K, ...args: EventArgs<TEvents, K>): boolean;
    emit(eventName: string | symbol, ...args: any[]): boolean;
    emit(eventName: string | symbol, ...args: any[]): boolean {
        return super.emit(eventName, ...args);
    }

    listeners<K extends EventKey<TEvents>>(event: K): Array<EventListener<TEvents, K>>;
    listeners(eventName: string | symbol): Function[];
    listeners(eventName: string | symbol): Function[] {
        return super.listeners(eventName) as Function[];
    }

    rawListeners<K extends EventKey<TEvents>>(event: K): Array<EventListener<TEvents, K>>;
    rawListeners(eventName: string | symbol): Function[];
    rawListeners(eventName: string | symbol): Function[] {
        return super.rawListeners(eventName) as Function[];
    }

    listenerCount<K extends EventKey<TEvents>>(event: K): number;
    listenerCount(eventName: string | symbol): number;
    listenerCount(eventName: string | symbol): number {
        return super.listenerCount(eventName);
    }

    eventNames(): Array<EventKey<TEvents>>;
    eventNames(): Array<string | symbol>;
    eventNames(): Array<string | symbol> {
        return super.eventNames();
    }
}
