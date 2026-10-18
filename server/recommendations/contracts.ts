export interface InferenceRequest {
  system: string;
  data: unknown;
  schema: object;
  signal: AbortSignal;
}

// A future Qwen adapter implements this same provider-neutral JSON boundary.
export interface RecommendationProvider {
  readonly provider: string;
  readonly model: string;
  verify(signal: AbortSignal): Promise<void>;
  generate(request: InferenceRequest): Promise<unknown>;
}
