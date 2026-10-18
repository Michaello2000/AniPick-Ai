export interface InferenceRequest {
  system: string;
  data: unknown;
  schema: object;
  signal: AbortSignal;
}

// Cloud and loopback adapters share the same validated recommendation boundary.
export interface RecommendationProvider {
  readonly provider: string;
  readonly model: string;
  verify(signal: AbortSignal): Promise<void>;
  generate(request: InferenceRequest): Promise<unknown>;
}
