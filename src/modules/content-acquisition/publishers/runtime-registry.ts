import { CandidatePublisherRegistry } from "./candidate-publisher-registry";

// ARTICLE-001 and MEDIA-001 register production publishers here. REVIEW-001
// deliberately fails closed instead of installing the deterministic test fake.
export const contentWorkflowPublishers = new CandidatePublisherRegistry();
