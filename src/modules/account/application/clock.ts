/**
 * Injected clock and randomness for account application use cases. Tests pass a
 * fixed clock/source so expiry and invitation-code checks are deterministic.
 */
export type AccountClock = () => Date;

export type RandomByteSource = (size: number) => Uint8Array;

export const systemAccountClock: AccountClock = () => new Date();
