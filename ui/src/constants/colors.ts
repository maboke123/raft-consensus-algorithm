export const roleColors = {
    Leader : "#2ea043",
    Follower : "#0366d6",
    Candidate : "#d73a49",
    Crashed : "#8b0000",
    Recover: "#2ea043",
    TakingSnapshot: "#f97316",
    InstallingSnapshot: "#8964c9",
    Learner: "#e3b341"
};

export const messageColors = {
    RequestVote: "#d73a49",
    RequestVoteResponse: "#d73a49",
    AppendEntries: "#0366d6",
    Heartbeat: "#42e4e7",
    Dropped: "#ef4444",
    InstallSnapshotRequest: "#f97316",
    InstallSnapshotResponse: "#f97316",
};

const termColors = [
    "#6f42c1",
    "#0366d6", 
    "#2ea043",
    "#d73a49",
    "#e3b341",
    "#a371f7",
    "#42e4e7"
];

export const termColor = (term: number) => termColors[(term - 1) % termColors.length];