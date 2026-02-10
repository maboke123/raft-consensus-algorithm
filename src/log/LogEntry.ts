export interface Command {
  type: string;
  payload: any;
}

export interface LogEntry {
  term: number;
  index: number;
  command: Command;
}