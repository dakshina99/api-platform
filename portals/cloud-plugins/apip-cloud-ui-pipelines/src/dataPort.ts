/*
 * Copyright (c) 2026, WSO2 LLC (http://www.wso2.com). All Rights Reserved.
 *
 * This software is the property of WSO2 LLC and its suppliers, if any.
 * Dissemination of any information or reproduction of any material contained
 * herein in any form is strictly forbidden, unless permitted by WSO2 expressly.
 * You may not alter or remove any copyright or other notice from copies of this content.
 */

/**
 * The pipelines data layer. It translates between the UI's linear stage view
 * models (`types.ts`) and the platform-api REST shapes, and is the only place
 * that talks to the backend — through the host-injected `apiFetch`, so the
 * feature stays portable across hosts (console, ai-workspace) that each wire
 * their own same-origin, BFF-authenticated transport.
 *
 * REST endpoints (base `/api/v0.9`, org resolved from the token):
 *   GET  /pipelines            -> { count, list: PipelineDTO[] }
 *   POST /pipelines            <- { name, promotionPaths, defaultGateways }
 *   PUT  /pipelines/{id}       <- same body (id in the path is the name)
 *   DELETE /pipelines/{id}     -> 204
 *   GET  /environments         -> { count, list: EnvironmentDTO[] }
 *   GET  /managed-gateways     -> { list: ManagedGatewayDTO[] }
 */

import type { ApiFetch } from './hostPort';
import type {
  CreatePipelineInput,
  Environment,
  Pipeline,
  PipelineStage,
  UpdatePipelineInput,
} from './types';

type EnvironmentDTO = { id?: string; name: string; isProduction?: boolean };
type EnvironmentListDTO = { count?: number; list?: EnvironmentDTO[] };
type ManagedGatewayDTO = { id: string; environment: string; host?: string };
type ManagedGatewayListDTO = { list?: ManagedGatewayDTO[] };
type PromotionPathDTO = { sourceEnvironment: string; targetEnvironments: string[] };
type DefaultGatewayDTO = { environment: string; gatewayId: string };
type PipelineDTO = {
  id: string;
  name: string;
  promotionPaths?: PromotionPathDTO[];
  defaultGateways?: DefaultGatewayDTO[];
};
type PipelineListDTO = { count?: number; list?: PipelineDTO[] };

export interface PipelinePort {
  listEnvironments(): Promise<Environment[]>;
  listPipelines(environments: Environment[]): Promise<Pipeline[]>;
  createPipeline(input: CreatePipelineInput, environments: Environment[]): Promise<void>;
  updatePipeline(input: UpdatePipelineInput, environments: Environment[]): Promise<void>;
  deletePipeline(id: string): Promise<void>;
}

const toEnvironments = (
  environments: EnvironmentDTO[],
  gateways: ManagedGatewayDTO[]
): Environment[] =>
  environments.map((environment) => ({
    id: environment.id ?? environment.name,
    name: environment.name,
    critical: environment.isProduction ?? false,
    gateways: gateways
      .filter((gateway) => gateway.environment === environment.name)
      .map((gateway) => ({ id: gateway.id, name: gateway.host || gateway.id })),
  }));

/**
 * Flattens the API's promotion-path graph into the linear order the UI renders.
 * A pipeline built here is always linear, so the common case round-trips
 * exactly; a branching graph authored elsewhere degrades gracefully — the first
 * target of each source is followed and any unreached environments are appended.
 */
const orderEnvironmentNames = (paths: PromotionPathDTO[]): string[] => {
  const next = new Map<string, string>();
  const sources = new Set<string>();
  const targets = new Set<string>();
  const firstSeen: string[] = [];
  const see = (name: string) => {
    if (!firstSeen.includes(name)) firstSeen.push(name);
  };
  for (const path of paths) {
    see(path.sourceEnvironment);
    sources.add(path.sourceEnvironment);
    if (!next.has(path.sourceEnvironment) && path.targetEnvironments.length > 0) {
      next.set(path.sourceEnvironment, path.targetEnvironments[0]);
    }
    for (const target of path.targetEnvironments) {
      see(target);
      targets.add(target);
    }
  }
  const head = firstSeen.find((name) => sources.has(name) && !targets.has(name)) ?? firstSeen[0];
  const chain: string[] = [];
  const walked = new Set<string>();
  let current: string | undefined = head;
  while (current && !walked.has(current)) {
    walked.add(current);
    chain.push(current);
    current = next.get(current);
  }
  for (const name of firstSeen) {
    if (!walked.has(name)) chain.push(name);
  }
  return chain;
};

const toPipeline = (dto: PipelineDTO, environments: Environment[]): Pipeline => {
  const defaults = new Map(
    (dto.defaultGateways ?? []).map((entry) => [entry.environment, entry.gatewayId])
  );
  const stages: PipelineStage[] = orderEnvironmentNames(dto.promotionPaths ?? []).map((name) => {
    const environment = environments.find((candidate) => candidate.name === name);
    let defaultGatewayId = defaults.get(name) ?? '';
    if (!defaultGatewayId && environment && environment.gateways.length === 1) {
      defaultGatewayId = environment.gateways[0].id;
    }
    return {
      id: crypto.randomUUID(),
      environmentId: environment?.id ?? name,
      defaultGatewayId,
    };
  });
  return { id: dto.id, name: dto.name, stages };
};

const toPromotionPaths = (
  stages: PipelineStage[],
  environments: Environment[]
): PromotionPathDTO[] => {
  const name = (environmentId: string) =>
    environments.find((environment) => environment.id === environmentId)?.name ?? environmentId;
  const paths: PromotionPathDTO[] = [];
  for (let index = 0; index < stages.length - 1; index += 1) {
    paths.push({
      sourceEnvironment: name(stages[index].environmentId),
      targetEnvironments: [name(stages[index + 1].environmentId)],
    });
  }
  return paths;
};

/**
 * Only environments with more than one gateway need an explicit default; the
 * API defaults single-gateway environments automatically.
 */
const toDefaultGateways = (
  stages: PipelineStage[],
  environments: Environment[]
): DefaultGatewayDTO[] => {
  const entries: DefaultGatewayDTO[] = [];
  for (const stage of stages) {
    const environment = environments.find((candidate) => candidate.id === stage.environmentId);
    if (environment && environment.gateways.length > 1 && stage.defaultGatewayId) {
      entries.push({ environment: environment.name, gatewayId: stage.defaultGatewayId });
    }
  }
  return entries;
};

export function createRestPipelinePort(apiFetch: ApiFetch): PipelinePort {
  return {
    async listEnvironments() {
      const [environments, gateways] = await Promise.all([
        apiFetch<EnvironmentListDTO>('GET', '/environments'),
        apiFetch<ManagedGatewayListDTO>('GET', '/managed-gateways'),
      ]);
      return toEnvironments(environments?.list ?? [], gateways?.list ?? []);
    },
    async listPipelines(environments) {
      const pipelines = await apiFetch<PipelineListDTO>('GET', '/pipelines');
      return (pipelines?.list ?? []).map((dto) => toPipeline(dto, environments));
    },
    async createPipeline(input, environments) {
      await apiFetch('POST', '/pipelines', {
        name: input.name,
        promotionPaths: toPromotionPaths(input.stages, environments),
        defaultGateways: toDefaultGateways(input.stages, environments),
      });
    },
    async updatePipeline(input, environments) {
      await apiFetch('PUT', `/pipelines/${encodeURIComponent(input.id)}`, {
        name: input.name,
        promotionPaths: toPromotionPaths(input.stages, environments),
        defaultGateways: toDefaultGateways(input.stages, environments),
      });
    },
    async deletePipeline(id) {
      await apiFetch('DELETE', `/pipelines/${encodeURIComponent(id)}`);
    },
  };
}
