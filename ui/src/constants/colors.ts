export const roleColors = {
    Leader : "#2ea043",
    Follower : "#0366d6",
    Candidate : "#d73a49",
    Crashed : "#8b0000",
};

export const messageColors = {
    RequestVote: "#d73a49",
    RequestVoteResponse: "#d73a49",
    AppendEntries: "#0366d6",
    Heartbeat: "#42e4e7",
    Dropped: "#ef4444",
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