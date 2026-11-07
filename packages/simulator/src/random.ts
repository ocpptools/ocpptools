// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

/** A deterministic or ambient source of numbers in the range [0, 1). */
export type RandomSource = () => number;

/** The default source. Tests inject a scripted source instead. */
export const defaultRandom: RandomSource = () => Math.random();
