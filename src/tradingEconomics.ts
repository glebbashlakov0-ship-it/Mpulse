export const PLATFORM_FEE_RATE = 0.02;

export function calculatePlatformFee(grossAmount: number) {
  return roundMoney(grossAmount * PLATFORM_FEE_RATE);
}

export function calculateNetStake(grossAmount: number) {
  return roundMoney(grossAmount - calculatePlatformFee(grossAmount));
}

export function calculateGrossFromNetStake(netStake: number) {
  return roundMoney(netStake / (1 - PLATFORM_FEE_RATE));
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
