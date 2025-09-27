import { config } from '@/config/env';
import { Persona } from '@/entities/Persona';
import { Simulation } from '@/entities/Simulation';

export type RagCollectionName = 'personas' | 'simulations' | 'persona_docs' | 'simulation_docs';

interface RagHealth {
  status: string;
  collections?: string[];
  persistence?: string;
  embedding_model?: string;
}

interface RagUpsertResponse {
  upserted: number;
  collection: string;
}

interface RagQueryResponse<TMeta = any> {
  ids: string[];
  documents: string[];
  metadatas: Array<TMeta | null>;
  distances?: number[];
}

interface RagListResponse<TMeta = any> {
  ids: string[];
  documents: string[];
  metadatas: Array<TMeta | null>;
}

interface EnsureCollectionInput {
  name: string;
  metadata?: Record<string, any>;
}

interface UpsertInput<TMeta = any> {
  collection: RagCollectionName | string;
  documents: string[];
  ids?: string[];
  metadatas?: Array<TMeta | undefined | null>;
}

interface QueryInput {
  collection: RagCollectionName | string;
  query: string;
  top_k?: number;
  where?: Record<string, any>;
}

interface DeleteInput {
  collection: RagCollectionName | string;
  ids?: string[];
  where?: Record<string, any>;
}

export class RAGService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;

  // Availability cache to avoid hammering the health endpoint
  private lastAvailabilityCheck = 0;
  private availabilityTtlMs = 30_000; // 30s
  private cachedAvailability = false;

  // Static instance for cache management
  private static instance: RAGService | null = null;

  // Provide a singleton instance similar to other services
  private static getInstance(): RAGService {
    if (!RAGService.instance) {
      RAGService.instance = new RAGService();
    }
    return RAGService.instance;
  }

  // Safe array element access without dynamic bracket notation
  private static safeGet<T>(arr: Array<T> | undefined | null, index: number): T | undefined {
    if (!Array.isArray(arr)) return undefined;
    if (!Number.isInteger(index) || index < 0 || index >= arr.length) return undefined;
    return arr.slice(index, index + 1)[0];
  }

  constructor() {
    this.baseUrl = config.ai.rag.apiUrl;
    this.apiKey = config.ai.rag.apiKey;
    this.headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    // Store instance for static access
    RAGService.instance = this;
  }

  /**
   * Preload/initialize RAG microservice at app startup
   * - Checks availability
   * - Ensures doc collections
   * - Logs basic health info
   */
  public async preload(): Promise<void> {
    try {
      console.log('📚 Initializing RAG microservice connection...');
      const available = await this.isAvailable();
      if (available) {
        await this.ensureDocCollections();
        const health = await this.getHealthInfo();
        if (health) {
          const collections = Array.isArray(health.collections) ? health.collections.join(', ') : 'n/a';
          console.log(`✅ RAG microservice ready - Embedding model: ${String(health.embedding_model || 'unknown')}`);
          console.log(`📦 Collections: ${collections}`);
        } else {
          console.log('✅ RAG microservice is available');
        }
      } else {
        console.log('⚠️ RAG microservice not available, RAG context will be skipped');
      }
    } catch (error) {
      console.warn('🚨 Failed to initialize RAG microservice:', error);
    }
  }

  // ---------- Static convenience wrappers (cached instance usage) ----------
  static async preload(): Promise<void> {
    return RAGService.getInstance().preload();
  }

  static async isAvailable(forceRefresh = false): Promise<boolean> {
    return RAGService.getInstance().isAvailable(forceRefresh);
  }

  static async getHealthInfo(): Promise<RagHealth | null> {
    return RAGService.getInstance().getHealthInfo();
  }

  static async ensureDocCollections(): Promise<void> {
    return RAGService.getInstance().ensureDocCollections();
  }

  static async upsertPersonaDocs(personaId: string, docs: Array<{ id?: string; text: string; metadata?: Record<string, any> }>): Promise<RagUpsertResponse | null> {
    return RAGService.getInstance().upsertPersonaDocs(personaId, docs);
  }

  static async deleteDocuments(input: DeleteInput): Promise<boolean> {
    return RAGService.getInstance().deleteDocuments(input);
  }

  static async deleteAllPersonaDocs(personaId: string): Promise<boolean> {
    return RAGService.getInstance().deleteAllPersonaDocs(personaId);
  }

  static async searchPersonaDocs(personaId: string, query: string, topK = 5, where?: Record<string, any>) {
    return RAGService.getInstance().searchPersonaDocs(personaId, query, topK, where);
  }

  static async upsertSimulationDocs(simulationId: string, docs: Array<{ id?: string; text: string; metadata?: Record<string, any> }>): Promise<RagUpsertResponse | null> {
    return RAGService.getInstance().upsertSimulationDocs(simulationId, docs);
  }

  static async deleteAllSimulationDocs(simulationId: string): Promise<boolean> {
    return RAGService.getInstance().deleteAllSimulationDocs(simulationId);
  }

  static async searchSimulationDocs(simulationId: string, query: string, topK = 5, where?: Record<string, any>) {
    return RAGService.getInstance().searchSimulationDocs(simulationId, query, topK, where);
  }

  static async buildRagContextForConversation(options: {
    persona?: Persona;
    simulation?: Simulation;
    personaId?: string;
    simulationId?: string;
    query: string;
    topKPerSource?: number;
    maxCharsPerDoc?: number;
    maxSectionChars?: number;
  }): Promise<string> {
    return RAGService.getInstance().buildRagContextForConversation(options);
  }

  static async listPersonaDocs(personaId: string, limit = 100, offset = 0) {
    return RAGService.getInstance().listPersonaDocs(personaId, limit, offset);
  }

  static async listSimulationDocs(simulationId: string, limit = 100, offset = 0) {
    return RAGService.getInstance().listSimulationDocs(simulationId, limit, offset);
  }

  // ---------- Availability ----------
  async isAvailable(forceRefresh = false): Promise<boolean> {
    const now = Date.now();
    if (!forceRefresh && (now - this.lastAvailabilityCheck) < this.availabilityTtlMs) {
      return this.cachedAvailability;
    }

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(5_000),
      });

      const ok = response.ok;
      if (!ok) {
        this.cachedAvailability = false;
        this.lastAvailabilityCheck = now;
        return false;
      }

      const health = await response.json() as RagHealth;
      const isHealthy = health.status === 'healthy';
      this.cachedAvailability = isHealthy;
      this.lastAvailabilityCheck = now;
      return isHealthy;
    } catch (error) {
      this.cachedAvailability = false;
      this.lastAvailabilityCheck = now;
      if (config.isDevelopment) {
        console.warn('🚨 RAG service not available:', error instanceof Error ? error.message : 'Unknown error');
      }
      return false;
    }
  }

  async getHealthInfo(): Promise<RagHealth | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      return await response.json() as RagHealth;
    } catch {
      return null;
    }
  }

  // ---------- Collections ----------
  async ensureCollection(name: RagCollectionName | string, metadata?: Record<string, any>): Promise<void> {
    if (!(await this.isAvailable())) return; // guarded no-op
    try {
      const body: EnsureCollectionInput = { name, metadata };
      const response = await fetch(`${this.baseUrl}/collections`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`🚨 RAG ensureCollection failed: ${response.status} ${response.statusText} ${text}`);
      }
    } catch (error) {
      console.warn('🚨 RAG ensureCollection error:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async ensureDocCollections(): Promise<void> {
    await Promise.all([
      this.ensureCollection('persona_docs'),
      this.ensureCollection('simulation_docs'),
    ]);
  }

  async listCollections(): Promise<Array<{ name: string; metadata?: any }>> {
    if (!(await this.isAvailable())) return [];
    try {
      const response = await fetch(`${this.baseUrl}/collections`, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return [];
      return await response.json() as Array<{ name: string; metadata?: any }>;
    } catch {
      return [];
    }
  }

  async deleteCollection(name: RagCollectionName | string): Promise<void> {
    if (!(await this.isAvailable())) return;
    try {
      const response = await fetch(`${this.baseUrl}/collections/${encodeURIComponent(String(name))}`, {
        method: 'DELETE',
        headers: this.headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(`RAG deleteCollection failed: ${response.status} ${response.statusText} ${text}`);
      }
    } catch (error) {
      console.warn('RAG deleteCollection error:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // ---------- Documents ----------
  async upsertDocuments<TMeta = any>(input: UpsertInput<TMeta>): Promise<RagUpsertResponse | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const response = await fetch(`${this.baseUrl}/upsert`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          collection: input.collection,
          documents: input.documents,
          ids: input.ids,
          metadatas: input.metadatas,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Upsert failed: ${response.status} ${response.statusText} ${text}`);
      }
      return await response.json() as RagUpsertResponse;
    } catch (error) {
      console.warn('RAG upsertDocuments error:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  async deleteDocuments(input: DeleteInput): Promise<boolean> {
    if (!(await this.isAvailable())) return false;
    try {
      const response = await fetch(`${this.baseUrl}/delete`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          collection: input.collection,
          ids: input.ids,
          where: input.where,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok;
    } catch (error) {
      console.warn('RAG deleteDocuments error:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  async query(input: QueryInput): Promise<RagQueryResponse | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const response = await fetch(`${this.baseUrl}/query`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          collection: input.collection,
          query: input.query,
          top_k: input.top_k ?? 5,
          where: input.where,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      return await response.json() as RagQueryResponse;
    } catch (error) {
      console.warn('RAG query error:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  async list(input: { collection: RagCollectionName | string; where?: Record<string, any>; limit?: number; offset?: number }): Promise<RagListResponse | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const response = await fetch(`${this.baseUrl}/list`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          collection: input.collection,
          where: input.where,
          limit: input.limit ?? 100,
          offset: input.offset ?? 0,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      return await response.json() as RagListResponse;
    } catch (error) {
      console.warn('RAG list error:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  // ---------- Persona & Simulation document management ----------
  async upsertPersonaDocs(personaId: string, docs: Array<{ id?: string; text: string; metadata?: Record<string, any> }>): Promise<RagUpsertResponse | null> {
    if (!(await this.isAvailable())) return null;
    await this.ensureCollection('persona_docs');
    const ids = docs.map((d, i) => d.id || `persona:${personaId}:${Date.now()}:${i}`);
    const documents = docs.map(d => d.text);
    const metadatas = docs.map(d => ({ ...(d.metadata || {}), personaId }));
    return this.upsertDocuments({ collection: 'persona_docs', documents, ids, metadatas });
  }

  async upsertSimulationDocs(simulationId: string, docs: Array<{ id?: string; text: string; metadata?: Record<string, any> }>): Promise<RagUpsertResponse | null> {
    if (!(await this.isAvailable())) return null;
    await this.ensureCollection('simulation_docs');
    const ids = docs.map((d, i) => d.id || `simulation:${simulationId}:${Date.now()}:${i}`);
    const documents = docs.map(d => d.text);
    const metadatas = docs.map(d => ({ ...(d.metadata || {}), simulationId }));
    return this.upsertDocuments({ collection: 'simulation_docs', documents, ids, metadatas });
  }

  async searchPersonaDocs(personaId: string, query: string, topK = 5, where?: Record<string, any>): Promise<Array<{ id: string; text: string; metadata: any; distance?: number }>> {
    const mergedWhere = { ...(where || {}), personaId };
    const result = await this.query({ collection: 'persona_docs', query, top_k: topK, where: mergedWhere });
    if (!result) return [];
    const items: Array<{ id: string; text: string; metadata: any; distance?: number }> = [];
    const docCount = Array.isArray(result.documents) ? result.documents.length : 0;
    for (let i = 0; i < docCount; i++) {
      const id = RAGService.safeGet(result.ids, i);
      const text = RAGService.safeGet(result.documents, i);
      const metadata = RAGService.safeGet(result.metadatas, i);
      const distance = RAGService.safeGet(result.distances, i);
      if (typeof id === 'string' && typeof text === 'string') {
        items.push({
          id,
          text,
          metadata,
          distance,
        });
      }
    }
    return items;
  }

  async listPersonaDocs(personaId: string, limit = 100, offset = 0): Promise<Array<{ id: string; text: string; metadata: any }>> {
    const result = await this.list({ collection: 'persona_docs', where: { personaId }, limit, offset });
    if (!result) return [];
    const items: Array<{ id: string; text: string; metadata: any }> = [];
    const docCount = Array.isArray(result.documents) ? result.documents.length : 0;
    for (let i = 0; i < docCount; i++) {
      const id = RAGService.safeGet(result.ids, i);
      const text = RAGService.safeGet(result.documents, i);
      const metadata = RAGService.safeGet(result.metadatas, i);
      if (typeof id === 'string' && typeof text === 'string') {
        items.push({ id, text, metadata });
      }
    }
    return items;
  }

  async searchSimulationDocs(simulationId: string, query: string, topK = 5, where?: Record<string, any>): Promise<Array<{ id: string; text: string; metadata: any; distance?: number }>> {
    const mergedWhere = { ...(where || {}), simulationId };
    const result = await this.query({ collection: 'simulation_docs', query, top_k: topK, where: mergedWhere });
    if (!result) return [];
    const items: Array<{ id: string; text: string; metadata: any; distance?: number }> = [];
    const docCount = Array.isArray(result.documents) ? result.documents.length : 0;
    for (let i = 0; i < docCount; i++) {
      const id = RAGService.safeGet(result.ids, i);
      const text = RAGService.safeGet(result.documents, i);
      const metadata = RAGService.safeGet(result.metadatas, i);
      const distance = RAGService.safeGet(result.distances, i);
      if (typeof id === 'string' && typeof text === 'string') {
        items.push({
          id,
          text,
          metadata,
          distance,
        });
      }
    }
    return items;
  }

  async listSimulationDocs(simulationId: string, limit = 100, offset = 0): Promise<Array<{ id: string; text: string; metadata: any }>> {
    const result = await this.list({ collection: 'simulation_docs', where: { simulationId }, limit, offset });
    if (!result) return [];
    const items: Array<{ id: string; text: string; metadata: any }> = [];
    const docCount = Array.isArray(result.documents) ? result.documents.length : 0;
    for (let i = 0; i < docCount; i++) {
      const id = RAGService.safeGet(result.ids, i);
      const text = RAGService.safeGet(result.documents, i);
      const metadata = RAGService.safeGet(result.metadatas, i);
      if (typeof id === 'string' && typeof text === 'string') {
        items.push({ id, text, metadata });
      }
    }
    return items;
  }

  async deleteAllPersonaDocs(personaId: string): Promise<boolean> {
    return this.deleteDocuments({ collection: 'persona_docs', where: { personaId } });
  }

  async deleteAllSimulationDocs(simulationId: string): Promise<boolean> {
    return this.deleteDocuments({ collection: 'simulation_docs', where: { simulationId } });
  }

  // ---------- Build context for AI prompts ----------
  async buildRagContextForConversation(options: {
    persona?: Persona;
    simulation?: Simulation;
    personaId?: string;
    simulationId?: string;
    query: string;
    topKPerSource?: number;
    maxCharsPerDoc?: number;
    maxSectionChars?: number;
  }): Promise<string> {
    if (!(await this.isAvailable())) return '';
    const personaId = options.persona?.id || options.personaId;
    const simulationId = options.simulation?.id || options.simulationId;
    const topK = Math.max(1, Math.min(10, options.topKPerSource ?? 3));
    const maxCharsPerDoc = Math.max(200, Math.min(4000, options.maxCharsPerDoc ?? 600));
    const maxSectionChars = Math.max(500, Math.min(8000, options.maxSectionChars ?? 2000));

    const sections: string[] = [];

    try {
      if (personaId) {
        const pDocs = await this.searchPersonaDocs(personaId, options.query, topK);
        if (pDocs.length) {
          const text = pDocs
            .map(d => (d.text || '').slice(0, maxCharsPerDoc))
            .join('\n---\n')
            .slice(0, maxSectionChars);
          if (text.trim().length > 0) {
            sections.push(['[Persona Knowledge]', text].join('\n'));
          }
        }
      }
    } catch (e) {
      console.warn('🚨 RAG persona docs fetch failed:', e instanceof Error ? e.message : String(e));
    }

    try {
      if (simulationId) {
        const sDocs = await this.searchSimulationDocs(simulationId, options.query, topK);
        if (sDocs.length) {
          const text = sDocs
            .map(d => (d.text || '').slice(0, maxCharsPerDoc))
            .join('\n---\n')
            .slice(0, maxSectionChars);
          if (text.trim().length > 0) {
            sections.push(['[Simulation Knowledge]', text].join('\n'));
          }
        }
      }
    } catch (e) {
      console.warn('🚨 RAG simulation docs fetch failed:', e instanceof Error ? e.message : String(e));
    }

    if (!sections.length) return '';
    return [
      'Use the following retrieved knowledge snippets to ground your response when relevant. If none are relevant, ignore them. Do not quote verbatim unless helpful.',
      sections.join('\n\n'),
    ].join('\n\n');
  }
}
