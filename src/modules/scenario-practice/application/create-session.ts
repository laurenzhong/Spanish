import type {
  CreateScenarioSessionInput,
  ScenarioPracticeRepository,
} from "../repositories";

export function createScenarioSession(
  repository: ScenarioPracticeRepository,
  input: CreateScenarioSessionInput,
) {
  return repository.createSession(input);
}
