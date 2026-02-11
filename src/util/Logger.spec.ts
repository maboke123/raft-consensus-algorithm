import { after, afterEach } from "node:test";
import { ConsoleLogger } from "./Logger";
import { describe, it, beforeEach, vi, expect } from "vitest";

describe('Logger.ts ConsoleLogger', () => {

    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        logSpy.mockClear();
    });

    afterEach(() => {
        logSpy.mockRestore();
    });

    it('should log messages from all levels', () => {
        const MyLogger = new ConsoleLogger('test-node', 'debug');
        MyLogger.debug("this is a debug message");
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenLastCalledWith(expect.stringContaining("[DEBUG]"));
        MyLogger.info("this is an info message");
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenLastCalledWith(expect.stringContaining("[INFO]"));
        MyLogger.warn("this is a warn message");
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenLastCalledWith(expect.stringContaining("[WARN]"));
        MyLogger.error("this is an error message");
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenLastCalledWith(expect.stringContaining("[ERROR]"));
    });

    it('should log messages only from min debug level and above', () => {
        const MyLogger = new ConsoleLogger('test-node', 'warn');
        MyLogger.debug("this is a debug message 2");
        expect(logSpy).not.toHaveBeenCalled();
        MyLogger.info("this is an info message");
        expect(logSpy).not.toHaveBeenCalled();
        MyLogger.warn("this is a warn message");
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenLastCalledWith(expect.stringContaining("[WARN]"));
        MyLogger.error("this is an error message");
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenLastCalledWith(expect.stringContaining("[ERROR]"));
    });

    it('should log messages with context', () => {
        const MyLogger = new ConsoleLogger('test-node', 'debug');
        MyLogger.info("this is an info message with context", { userId: 123, action: "login" });
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenLastCalledWith(expect.stringContaining(`{"userId":123,"action":"login"}`));
    });
})