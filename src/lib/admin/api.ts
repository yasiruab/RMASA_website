// Thin admin-side fetch helpers. Typed wrappers around /api/admin/calendar/*
// will be added here as the per-section components are extracted from the
// mega-component (Phases 3+).

export async function safeJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}
