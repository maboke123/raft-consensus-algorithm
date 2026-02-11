import { NodeId } from "../core/Config";

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';


export interface LogContext {
    [key: string]: any;
}

export interface Logger {
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext): void;
}

export class ConsoleLogger implements Logger {
    constructor(
        private nodeId: NodeId,
        private minDebugLevel: LogLevel = "info"
    ){}

    debug(message: string, context?: LogContext): void {
        this.printMessage(message, "debug", context);
    }

    info(message: string, context?: LogContext): void {
        this.printMessage(message, "info", context);
    }

    warn(message: string, context?: LogContext): void {
        this.printMessage(message, "warn", context);
    }
    
    error(message: string, context?: LogContext): void {
        this.printMessage(message, "error", context);
    }

    private printMessage(message: string, logLevel: LogLevel, context?: LogContext): void {
        if (this.shouldLog(logLevel)) {

            const timestamp = new Date().toISOString();
            const ctx = context ? `${JSON.stringify(context)}` : "";

            const toPrintMsg = `[${logLevel.toUpperCase()}] [${timestamp}] [${this.nodeId}] ${message}`
            console.log(toPrintMsg);
        }
    }

    private shouldLog(logLevel: LogLevel): boolean {
        const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
        const lowIdx = levels.indexOf(this.minDebugLevel);
        const currIdx = levels.indexOf(logLevel);

        return currIdx >= lowIdx
    }
}

const MyLogger = new ConsoleLogger('node 5', 'info');

MyLogger.debug("this is a debug message");
MyLogger.info("this is an info message", { someKey: "someValue" });
MyLogger.warn("this is a warning message");
MyLogger.error("this is an error message", { errorCode: 123 });