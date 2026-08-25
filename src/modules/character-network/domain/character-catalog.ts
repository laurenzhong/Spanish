export type NetworkCharacter = Readonly<{
  stableKey: "mateo" | "ines";
  version: 1;
  displayName: string;
  role: "interest-friend" | "life-relationship";
  homeLocation: string;
  topics: readonly string[];
}>;

export const networkCharacters: readonly NetworkCharacter[] = [
  {
    stableKey: "mateo",
    version: 1,
    displayName: "Mateo Ruiz",
    role: "interest-friend",
    homeLocation: "Valencia",
    topics: ["fotografía", "música", "comida local"],
  },
  {
    stableKey: "ines",
    version: 1,
    displayName: "Inés García",
    role: "life-relationship",
    homeLocation: "Barcelona",
    topics: ["trabajo", "rutinas", "barrios y mudanzas"],
  },
];

export function findNetworkCharacter(stableKey: string): NetworkCharacter | null {
  return networkCharacters.find((character) => character.stableKey === stableKey) ?? null;
}

