/** Payload of the server -> client `error` message (MSG.error). The connection stays open. */
export interface ErrorMsg {
  code: 'INVALID_PAYLOAD' | 'RATE_LIMITED' | 'UNKNOWN_MESSAGE' | 'NOT_FOUND' | 'NOT_ONLINE' | 'INTERNAL';
  /** The client message type that caused it. */
  type: string;
}
