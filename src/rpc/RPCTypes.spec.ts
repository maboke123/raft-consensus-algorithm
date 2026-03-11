import { describe, it, expect } from "vitest";
import { isRequestVoteRequestMessage,
        isRequestVoteResponseMessage,
        isAppendEntriesRequestMessage,
        isAppendEntriesResponseMessage,
        isInstallSnapshotRequestMessage,
        isInstallSnapshotResponseMessage,
        RequestVoteRequestMessage,
        RequestVoteResponseMessage,
        AppendEntriesRequestMessage,
        AppendEntriesResponseMessage,
        InstallSnapshotRequestMessage,
        InstallSnapshotResponseMessage,
        validateAppendEntriesRequest,
        validateAppendEntriesResponse,
        validateRequestVoteRequest,
        validateRequestVoteResponse,
        validateInstallSnapshotRequest,
        validateInstallSnapshotResponse,
        validateRPCMessage
        } from "./RPCTypes";
import { config } from "node:process";

describe('RPCTypes.ts, isRequestVoteRequestMessage', () => {

    const validMessage: RequestVoteRequestMessage = {
        type: "RequestVote",
        direction: "request",
        payload: {
            term: 1,
            candidateId: "node1",
            lastLogIndex: 0,
            lastLogTerm: 0
        }
    };

    const invalidMessage1 = {
        type: "AppendEntries",
        direction: "request",
        payload: {
            term: 1,
            candidateId: "node1",
            lastLogIndex: 0,
            lastLogTerm: 0
        }
    } as any;

    const invalidMessage2 = {
        type: "RequestVote",
        direction: "response",
        payload: {
            term: 1,
            candidateId: "node1",
            lastLogIndex: 0,
            lastLogTerm: 0
        }
    } as any;

    it('should return true for valid RequestVoteRequestMessage', () => {
        expect(isRequestVoteRequestMessage(validMessage)).toBe(true);
    });

    it('should return false for invalid RequestVoteRequestMessage with wrong type', () => {
        expect(isRequestVoteRequestMessage(invalidMessage1)).toBe(false);
    });

    it('should return false for invalid RequestVoteRequestMessage with wrong direction', () => {
        expect(isRequestVoteRequestMessage(invalidMessage2)).toBe(false);
    });
});

describe('RPCTypes.ts, isRequestVoteResponseMessage', () => {

    const validMessage: RequestVoteResponseMessage = {
        type: "RequestVote",
        direction: "response",
        payload: {
            term: 1,
            voteGranted: true
        }
    };

    const invalidMessage1 = {
        type: "AppendEntries",
        direction: "response",
        payload: {
            term: 1,
            voteGranted: true
        }
    } as any;

    const invalidMessage2 = {
        type: "RequestVote",
        direction: "request",
        payload: {
            term: 1,
            voteGranted: true
        }
    } as any;

    it('should return true for valid RequestVoteResponseMessage', () => {
        expect(isRequestVoteResponseMessage(validMessage)).toBe(true);
    });

    it('should return false for invalid RequestVoteResponseMessage with wrong type', () => {
        expect(isRequestVoteResponseMessage(invalidMessage1)).toBe(false);
    });

    it('should return false for invalid RequestVoteResponseMessage with wrong direction', () => {
        expect(isRequestVoteResponseMessage(invalidMessage2)).toBe(false);
    });
});

describe('RPCTypes.ts, isAppendEntriesRequestMessage', () => {

    const validMessage: AppendEntriesRequestMessage = {
        type: "AppendEntries",
        direction: "request",
        payload: {
            term: 1,
            leaderId: "node1",
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [],
            leaderCommit: 0
        }
    };

    const invalidMessage1 = {
        type: "RequestVote",
        direction: "request",
        payload: {
            term: 1,
            leaderId: "node1",
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [],
            leaderCommit: 0
        }
    } as any;

    const invalidMessage2 = {
        type: "AppendEntries",
        direction: "response",
        payload: {
            term: 1,
            leaderId: "node1",
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [],
            leaderCommit: 0
        }
    } as any;

    it('should return true for valid AppendEntriesRequestMessage', () => {
        expect(isAppendEntriesRequestMessage(validMessage)).toBe(true);
    });

    it('should return false for invalid AppendEntriesRequestMessage with wrong type', () => {
        expect(isAppendEntriesRequestMessage(invalidMessage1)).toBe(false);
    });

    it('should return false for invalid AppendEntriesRequestMessage with wrong direction', () => {
        expect(isAppendEntriesRequestMessage(invalidMessage2)).toBe(false);
    });
});

describe('RPCTypes.ts, isAppendEntriesResponseMessage', () => {

    const validMessage: AppendEntriesResponseMessage = {
        type: "AppendEntries",
        direction: "response",
        payload: {
            term: 1,
            success: true
        }
    };

    const invalidMessage1 = {
        type: "RequestVote",
        direction: "response",
        payload: {
            term: 1,
            success: true
        }
    } as any;

    const invalidMessage2 = {
        type: "AppendEntries",
        direction: "request",
        payload: {
            term: 1,
            success: true
        }
    } as any;

    it('should return true for valid AppendEntriesResponseMessage', () => {
        expect(isAppendEntriesResponseMessage(validMessage)).toBe(true);
    });

    it('should return false for invalid AppendEntriesResponseMessage with wrong type', () => {
        expect(isAppendEntriesResponseMessage(invalidMessage1)).toBe(false);
    });

    it('should return false for invalid AppendEntriesResponseMessage with wrong direction', () => {
        expect(isAppendEntriesResponseMessage(invalidMessage2)).toBe(false);
    });
});

describe('RPCTypes.ts, isInstallSnapshotRequestMessage', () => {
    const validMessage: InstallSnapshotRequestMessage = {
        type: "InstallSnapshot",
        direction: "request",
        payload: {
            term: 1,
            leaderId: "node1",
            lastIncludedIndex: 0,
            lastIncludedTerm: 0,
            data: Buffer.from("snapshot data"),
            config: { 
                voters: [
                    {id: "node1", address: "localhost:9092"},
                    { id: "node2", address: "localhost:9093"}
                ],    
                learners: [] 
            }
        }
    };

    const invalidMessage1 = {
        type: "RequestVote",
        direction: "request",
        payload: {
            term: 1,
            leaderId: "node1",
            lastIncludedIndex: 0,
            lastIncludedTerm: 0,
            data: Buffer.from("snapshot data"),
            config: { voters: ['node1', 'node2'], learners: [] }
        }
    } as any;

    const invalidMessage2 = {
        type: "InstallSnapshot",
        direction: "response",
        payload: {
            term: 1,
            leaderId: "node1",
            lastIncludedIndex: 0,
            lastIncludedTerm: 0,
            data: Buffer.from("snapshot data"),
            config: { voters: ['node1', 'node2'], learners: [] }
        }
    } as any;

    it('should return true for valid InstallSnapshotRequestMessage', () => {
        expect(isInstallSnapshotRequestMessage(validMessage)).toBe(true);
    });

    it('should return false for invalid InstallSnapshotRequestMessage with wrong type', () => {
        expect(isInstallSnapshotRequestMessage(invalidMessage1)).toBe(false);
    });

    it('should return false for invalid InstallSnapshotRequestMessage with wrong direction', () => {
        expect(isInstallSnapshotRequestMessage(invalidMessage2)).toBe(false);
    });
});

describe('RPCTypes.ts, isInstallSnapshotResponseMessage', () => {
    const validMessage: InstallSnapshotResponseMessage = {
        type: "InstallSnapshot",
        direction: "response",
        payload: {
            term: 1,
            success: true
        }
    };

    const invalidMessage1 = {
        type: "RequestVote",
        direction: "response",
        payload: {
            term: 1,
            success: true
        }
    } as any;

    const invalidMessage2 = {
        type: "InstallSnapshot",
        direction: "request",
        payload: {
            term: 1,
            success: true
        }
    } as any;

    it('should return true for valid InstallSnapshotResponseMessage', () => {
        expect(isInstallSnapshotResponseMessage(validMessage)).toBe(true);
    });

    it('should return false for invalid InstallSnapshotResponseMessage with wrong type', () => {
        expect(isInstallSnapshotResponseMessage(invalidMessage1)).toBe(false);
    });

    it('should return false for invalid InstallSnapshotResponseMessage with wrong direction', () => {
        expect(isInstallSnapshotResponseMessage(invalidMessage2)).toBe(false);
    });
});

describe("RPCTypes.ts, validateRequestVoteRequest", () => {

    const validRequest = {
        term: 1,
        candidateId: "node1",
        lastLogIndex: 0,
        lastLogTerm: 0
    };
    const invalidRequest1 = {
        term: "not an integer" as any,
        candidateId: "node1",
        lastLogIndex: 0,
        lastLogTerm: 0
    };
    const invalidRequest2 = {
        term: -1,
        candidateId: "node1",
        lastLogIndex: 0,
        lastLogTerm: 0
    };
    const invalidRequest3 = {
        term: 1,
        candidateId: "",
        lastLogIndex: 0,
        lastLogTerm: 0
    };
    const invalidRequest4 = {
        term: 1,
        candidateId: 123 as any,
        lastLogIndex: 0,
        lastLogTerm: 0
    };
    const invalidRequest5 = {
        term: 1,
        candidateId: "node1",
        lastLogIndex: "not an integer" as any,
        lastLogTerm: 0
    };
    const invalidRequest6 = {
        term: 1,
        candidateId: "node1",
        lastLogIndex: -1,
        lastLogTerm: 0
    };
    const invalidRequest7 = {
        term: 1,
        candidateId: "node1",
        lastLogIndex: 0,
        lastLogTerm: "not an integer" as any
    };
    const invalidRequest8 = {
        term: 1,
        candidateId: "node1",
        lastLogIndex: 0,
        lastLogTerm: -1
     };

    it ('should not throw error for valid RequestVoteRequest', () => {
        expect(() => validateRequestVoteRequest(validRequest)).not.toThrow();
    });

    it('should throw error for non integer term', () => {
        expect(() => validateRequestVoteRequest(invalidRequest1)).toThrow("Invalid term: not an integer. term must be a non-negative integer.");
    });

    it('should throw error for negative term', () => {
        expect(() => validateRequestVoteRequest(invalidRequest2)).toThrow("Invalid term: -1. term must be a non-negative integer.");
    });

    it('should throw error for empty candidateId', () => {
        expect(() => validateRequestVoteRequest(invalidRequest3)).toThrow("Invalid candidateId: . candidateId must be a non-empty string.");
    });

    it('should throw error for non string candidateId', () => {
        expect(() => validateRequestVoteRequest(invalidRequest4)).toThrow("Invalid candidateId: 123. candidateId must be a non-empty string.");
    });

    it('should throw error for non integer lastLogIndex', () => {
        expect(() => validateRequestVoteRequest(invalidRequest5)).toThrow("Invalid lastLogIndex: not an integer. lastLogIndex must be a non-negative integer.");
    });

    it('should throw error for negative lastLogIndex', () => {
        expect(() => validateRequestVoteRequest(invalidRequest6)).toThrow("Invalid lastLogIndex: -1. lastLogIndex must be a non-negative integer.");
    });

    it('should throw error for non integer lastLogTerm', () => {
        expect(() => validateRequestVoteRequest(invalidRequest7)).toThrow("Invalid lastLogTerm: not an integer. lastLogTerm must be a non-negative integer.");
    });

    it('should throw error for negative lastLogTerm', () => {
        expect(() => validateRequestVoteRequest(invalidRequest8)).toThrow("Invalid lastLogTerm: -1. lastLogTerm must be a non-negative integer.");
    });
});

describe('RPCTypes.ts, validateRequestVoteResponse', () => {

    const validResponse = {
        term: 1,
        voteGranted: true
    };
    const invalidResponse1 = {
        term: "not an integer" as any,
        voteGranted: true
    };
    const invalidResponse2 = {
        term: -1,
        voteGranted: true
    };
    const invalidResponse3 = {
        term: 1,
        voteGranted: "not a boolean" as any
     };

    it ('should not throw error for valid RequestVoteResponse', () => {
        expect(() => validateRequestVoteResponse(validResponse)).not.toThrow();
    });

    it('should throw error for non integer term', () => {
        expect(() => validateRequestVoteResponse(invalidResponse1)).toThrow("Invalid term: not an integer. term must be a non-negative integer.");
    });

    it('should throw error for negative term', () => {
        expect(() => validateRequestVoteResponse(invalidResponse2)).toThrow("Invalid term: -1. term must be a non-negative integer.");
    });

    it('should throw error for non boolean voteGranted', () => {
        expect(() => validateRequestVoteResponse(invalidResponse3)).toThrow("Invalid voteGranted: not a boolean. voteGranted must be a boolean.");
    });
});

describe('RPCTypes.ts, validateAppendEntriesRequest', () => {

    const validRequest = {
        term: 1,
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest1 = {
        term: "not an integer" as any,
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest2 = {
        term: -1,
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest3 = {
        term: 1,
        leaderId: "",
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest4 = {
        term: 1,
        leaderId: 123 as any,
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest5 = {
        term: 1,
        leaderId: "node1",
        prevLogIndex: "not an integer" as any,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest6 = {
        term: 1,
        leaderId: "node1",
        prevLogIndex: -1,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest7 = {
        term: 1,
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: "not an integer" as any,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest8 = {
        term: 1,
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: -1,
        leaderCommit: 0,
        entries: [],
    };
    const invalidRequest9 = {
        term: 1,
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: "not an integer" as any,
        entries: [],
    };
    const invalidRequest10 = {
        term: 1,        
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: -1,
        entries: [],
    };
    const invalidRequest11 = {
        term: 1,
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: "not an array" as any,
    };
    const invalidRequest12 = {
        term: 1,
        leaderId: "node1",
        prevLogIndex: 0,
        prevLogTerm: 0,
        leaderCommit: 0,
        entries: [123 as any],
    };

    it ('should not throw error for valid AppendEntriesRequest', () => {
        expect(() => validateAppendEntriesRequest(validRequest)).not.toThrow();
    });

    it('should throw error for non integer term', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest1)).toThrow("Invalid term: not an integer. term must be a non-negative integer.");
    });

    it('should throw error for negative term', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest2)).toThrow("Invalid term: -1. term must be a non-negative integer.");
    });

    it('should throw error for empty leaderId', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest3)).toThrow("Invalid leaderId: . leaderId must be a non-empty string.");
    });

    it('should throw error for non string leaderId', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest4)).toThrow("Invalid leaderId: 123. leaderId must be a non-empty string.");
    });

    it('should throw error for non integer prevLogIndex', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest5)).toThrow("Invalid prevLogIndex: not an integer. prevLogIndex must be a non-negative integer.");
    });

    it('should throw error for negative prevLogIndex', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest6)).toThrow("Invalid prevLogIndex: -1. prevLogIndex must be a non-negative integer.");
    });

    it('should throw error for non integer prevLogTerm', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest7)).toThrow("Invalid prevLogTerm: not an integer. prevLogTerm must be a non-negative integer.");
    });

    it('should throw error for negative prevLogTerm', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest8)).toThrow("Invalid prevLogTerm: -1. prevLogTerm must be a non-negative integer.");
    });

    it('should throw error for non integer leaderCommit', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest9)).toThrow("Invalid leaderCommit: not an integer. leaderCommit must be a non-negative integer.");
    });

    it('should throw error for negative leaderCommit', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest10)).toThrow("Invalid leaderCommit: -1. leaderCommit must be a non-negative integer.");
    });

    it('should throw error for non array entries', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest11)).toThrow("Invalid entries: not an array. entries must be an array of LogEntry objects.");
    });

    it('should throw error for entries array containing non object', () => {
        expect(() => validateAppendEntriesRequest(invalidRequest12)).toThrow("Invalid entries: 123. entries must be an array of LogEntry objects.");
    });
});

describe('RPCTypes.ts, validateAppendEntriesResponse', () => {

    const validResponse = {
        term: 1,
        success: true,
        matchIndex: 0,
        conflictIndex: 0,
        conflictTerm: 0
    };
    const invalidResponse1 = {
        term: "not an integer" as any,
        success: true,
        matchIndex: 0,
        conflictIndex: 0,
        conflictTerm: 0
    };
    const invalidResponse2 = {
        term: -1,
        success: true,
        matchIndex: 0,
        conflictIndex: 0,
        conflictTerm: 0
    };
    const invalidResponse3 = {
        term: 1,
        success: "not a boolean" as any,
        matchIndex: 0,
        conflictIndex: 0,
        conflictTerm: 0
    };
     const invalidResponse4 = {
        term: 1,
        success: true,
        matchIndex: "not an integer" as any,
        conflictIndex: 0,
        conflictTerm: 0
    };
    const invalidResponse5 = {
        term: 1,
        success: true,
        matchIndex: -1,
        conflictIndex: 0,
        conflictTerm: 0
    };
    const invalidResponse6 = {
        term: 1,
        success: true,
        matchIndex: 0,
        conflictIndex: "not an integer" as any,
        conflictTerm: 0
    };
    const invalidResponse7 = {
        term: 1,
        success: true,
        matchIndex: 0,
        conflictIndex: -1,
        conflictTerm: 0
    };
    const invalidResponse8 = {
        term: 1,
        success: true,
        matchIndex: 0,
        conflictIndex: 0,
        conflictTerm: "not an integer" as any
    };
    const invalidResponse9 = {
        term: 1,
        success: true,
        matchIndex: 0,
        conflictIndex: 0,
        conflictTerm: -1
     };

    it('should not throw error for valid AppendEntriesResponse', () => {
        expect(() => validateAppendEntriesResponse(validResponse)).not.toThrow();
    });

    it('should throw error for non integer term', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse1)).toThrow("Invalid term: not an integer. term must be a non-negative integer.");
    });

    it('should throw error for negative term', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse2)).toThrow("Invalid term: -1. term must be a non-negative integer.");
    });

    it('should throw error for non boolean success', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse3)).toThrow("Invalid success: not a boolean. success must be a boolean.");
    });

    it('should throw error for non integer matchIndex', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse4)).toThrow("Invalid matchIndex: not an integer. matchIndex must be a non-negative integer.");
    });

    it('should throw error for negative matchIndex', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse5)).toThrow("Invalid matchIndex: -1. matchIndex must be a non-negative integer.");
    });

    it('should throw error for non integer conflictIndex', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse6)).toThrow("Invalid conflictIndex: not an integer. conflictIndex must be a non-negative integer.");
    });

    it('should throw error for negative conflictIndex', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse7)).toThrow("Invalid conflictIndex: -1. conflictIndex must be a non-negative integer.");
    });

    it('should throw error for non integer conflictTerm', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse8)).toThrow("Invalid conflictTerm: not an integer. conflictTerm must be a non-negative integer.");
    });

    it('should throw error for negative conflictTerm', () => {
        expect(() => validateAppendEntriesResponse(invalidResponse9)).toThrow("Invalid conflictTerm: -1. conflictTerm must be a non-negative integer.");
    });
});

describe('RPCTypes.ts, validateInstallSnapshotRequest', () => {

    const validRequest = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { 
            voters: [
                {id: "node1", address: "localhost:9092"},
                {id: "node2", address: "localhost:9093"}
            ],
            learners: []
        }
    };
    const invalidRequest1 = {
        term: "not an integer" as any,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            {id: "node1", address: "localhost:9092"},
            {id: "node2", address: "localhost:9093"}
        ], learners: [] }
    };
    const invalidRequest2 = {
        term: -1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            { id: 'node1', address: 'localhost:9092' },
            { id: 'node2', address: 'localhost:9093' }
        ], learners: [] }
    };
    const invalidRequest3 = {
        term: 1,
        leaderId: "",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            {id: "node1", address: "localhost:9092"},
            {id: "node2", address: "localhost:9093"}
        ], learners: [] }
    };
    const invalidRequest4 = {
        term: 1,
        leaderId: 123 as any,
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            {id: "node1", address: "localhost:9092"},
            {id: "node2", address: "localhost:9093"}
        ], learners: [] }
    };
    const invalidRequest5 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: "not an integer" as any,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            {id: "node1", address: "localhost:9092"},
            {id: "node2", address: "localhost:9093"}
        ], learners: [] }
    };
    const invalidRequest6 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: -1,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            {id: "node1", address: "localhost:9092"},
            {id: "node2", address: "localhost:9093"}
        ], learners: [] }
    };
    const invalidRequest7 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: "not an integer" as any,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            {id: "node1", address: "localhost:9092"},
            {id: "node2", address: "localhost:9093"}
        ], learners: [] }
    };
    const invalidRequest8 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: -1,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            {id: "node1", address: "localhost:9092"},
            {id: "node2", address: "localhost:9093"}
        ], learners: [] }
    };
    const invalidRequest9 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: "not a buffer" as any,
        config: { voters: [
            {id: "node1", address: "localhost:9092"},
            {id: "node2", address: "localhost:9093"}
        ], learners: [] }
    };
    const invalidRequest10 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: null as any
    };
    const invalidRequest11 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: "not an array" } as any
    };
    const invalidRequest12 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [{ id: 123, address: "localhost:9092" }], learners: [] } as any
    };
    const invalidRequest13 = {
        term: 1,
        leaderId: "node1",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [], learners: [{ id: "node1", address: 999 }] } as any
    };

    it('should not throw error for valid InstallSnapshotRequest', () => {
        expect(() => validateInstallSnapshotRequest(validRequest)).not.toThrow();
    });

    it('should throw error for non integer term', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest1)).toThrow("Invalid term: not an integer. term must be a non-negative integer.");
    });

    it('should throw error for negative term', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest2)).toThrow("Invalid term: -1. term must be a non-negative integer.");
    });

    it('should throw error for empty leaderId', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest3)).toThrow("Invalid leaderId: . leaderId must be a non-empty string.");
    });

    it('should throw error for non string leaderId', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest4)).toThrow("Invalid leaderId: 123. leaderId must be a non-empty string.");
    });

    it('should throw error for non integer lastIncludedIndex', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest5)).toThrow("Invalid lastIncludedIndex: not an integer. lastIncludedIndex must be a non-negative integer.");
    });

    it('should throw error for negative lastIncludedIndex', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest6)).toThrow("Invalid lastIncludedIndex: -1. lastIncludedIndex must be a non-negative integer.");
    });

    it('should throw error for non integer lastIncludedTerm', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest7)).toThrow("Invalid lastIncludedTerm: not an integer. lastIncludedTerm must be a non-negative integer.");
    });

    it('should throw error for negative lastIncludedTerm', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest8)).toThrow("Invalid lastIncludedTerm: -1. lastIncludedTerm must be a non-negative integer.");
    });

    it('should throw error for non buffer data', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest9)).toThrow("Invalid data: not a buffer. data must be a Buffer.");
    });

    it('should throw error for null config', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest10)).toThrow("Invalid config: null. config must be an object.");
    });

    it('should throw error for config missing voters or learners', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest11)).toThrow("Invalid config: [object Object]. voters and learners must be arrays.");
    });
    it('should throw error for voter missing id or address', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest12)).toThrow(
            "Invalid config: voters must be ClusterMember objects with id and address strings."
        );
    });

    it('should throw error for learner missing id or address', () => {
        expect(() => validateInstallSnapshotRequest(invalidRequest13)).toThrow(
            "Invalid config: learners must be ClusterMember objects with id and address strings."
        );
    });
});

describe('RPCTypes.ts, validateInstallSnapshotResponse', () => {
    const validResponse = {
        term: 1,
        success: true
    };
    const invalidResponse1 = {
        term: "not an integer" as any,
        success: true
    };
    const invalidResponse2 = {
        term: -1,
        success: true
    };
    const invalidResponse3 = {
        term: 1,
        success: "not a boolean" as any
     };

    it('should not throw error for valid InstallSnapshotResponse', () => {
        expect(() => validateInstallSnapshotResponse(validResponse)).not.toThrow();
    });

    it('should throw error for non integer term', () => {
        expect(() => validateInstallSnapshotResponse(invalidResponse1)).toThrow("Invalid term: not an integer. term must be a non-negative integer.");
    });

    it('should throw error for negative term', () => {
        expect(() => validateInstallSnapshotResponse(invalidResponse2)).toThrow("Invalid term: -1. term must be a non-negative integer.");
    });

    it('should throw error for non boolean success', () => {
        expect(() => validateInstallSnapshotResponse(invalidResponse3)).toThrow("Invalid success: not a boolean. success must be a boolean.");
    });
});

describe('RPCTypes.ts, validateRPCMessage', () => {
    const validMessage: RequestVoteRequestMessage = {
        type: "RequestVote",
        direction: "request",
        payload: {
            term: 1,
            candidateId: "node1",
            lastLogIndex: 0,
            lastLogTerm: 0
        }
    };
    const validMessage2: RequestVoteResponseMessage = {
        type: "RequestVote",
        direction: "response",
        payload: {
            term: 1,
            voteGranted: true
        }
    };
    const validMessage3: AppendEntriesRequestMessage = {
        type: "AppendEntries",
        direction: "request",
        payload: {
            term: 1,
            leaderId: "node1",
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [],
            leaderCommit: 0
        }
    };
    const validMessage4: AppendEntriesResponseMessage = {
        type: "AppendEntries",
        direction: "response",
        payload: {
            term: 1,
            success: true,
            matchIndex: 0,
            conflictIndex: 0,
            conflictTerm: 0
        }
    };
    const validMessage5: InstallSnapshotRequestMessage = {
        type: "InstallSnapshot",
        direction: "request",
        payload: {
            term: 1,
            leaderId: "node1",
            lastIncludedIndex: 0,
            lastIncludedTerm: 0,
            data: Buffer.from("snapshot data"),
            config: {
                voters: [
                    { id: 'node1', address: 'localhost:9092'},
                    { id: 'node2', address: 'localhost:9093'}
                ],
                learners: []
            }
        }
    };
    const validMessage6: InstallSnapshotResponseMessage = {
        type: "InstallSnapshot",
        direction: "response",
        payload: {
            term: 1,
            success: true
        }
    };
    const invalidMessage1 = {
        type: "InvalidType",
        direction: "request",
        payload: {
            term: 1,
            candidateId: "node1",
            lastLogIndex: 0,
            lastLogTerm: 0
        }
    } as any;

    it ('should not throw error for valid RPCMessage of type RequestVoteRequest', () => {
        expect(() => validateRPCMessage(validMessage)).not.toThrow();
    });

    it ('should not throw error for valid RPCMessage of type RequestVoteResponse', () => {
        expect(() => validateRPCMessage(validMessage2)).not.toThrow();
    });

    it ('should not throw error for valid RPCMessage of type AppendEntriesRequest', () => {
        expect(() => validateRPCMessage(validMessage3)).not.toThrow();
    });

    it ('should not throw error for valid RPCMessage of type AppendEntriesResponse', () => {
        expect(() => validateRPCMessage(validMessage4)).not.toThrow();
    });

    it ('should not throw error for valid RPCMessage of type InstallSnapshotRequest', () => {
        expect(() => validateRPCMessage(validMessage5)).not.toThrow();
    });

    it ('should not throw error for valid RPCMessage of type InstallSnapshotResponse', () => {
        expect(() => validateRPCMessage(validMessage6)).not.toThrow();
    });

    it('should throw error for invalid RPCMessage with unknown type', () => {
        expect(() => validateRPCMessage(invalidMessage1)).toThrow("Unknown RPC message type.");
    });
});


