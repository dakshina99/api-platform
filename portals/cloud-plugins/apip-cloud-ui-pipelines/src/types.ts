/*
 * Copyright (c) 2026, WSO2 LLC (http://www.wso2.com). All Rights Reserved.
 *
 * This software is the property of WSO2 LLC and its suppliers, if any.
 * Dissemination of any information or reproduction of any material contained
 * herein in any form is strictly forbidden, unless permitted by WSO2 expressly.
 * You may not alter or remove any copyright or other notice from copies of this content.
 */

/**
 * View models the pipelines UI renders. They are derived from, and serialized
 * back to, the platform-api REST shapes (promotion paths + default gateways;
 * see `dataPort.ts`) — the UI keeps a linear stage model because that is the
 * only topology the builder creates, while the wire format is the API's graph.
 */

/** A managed gateway available in an environment. `name` is its resolved host. */
export type Gateway = {
  id: string;
  name: string;
};

/**
 * A deployment environment plus the managed gateways bound to it (sourced from
 * `/managed-gateways`, grouped by environment). `critical` mirrors the API's
 * `isProduction` and drives the "Critical" badge on a stage.
 */
export type Environment = {
  id: string;
  name: string;
  gateways: Gateway[];
  critical?: boolean;
};

/**
 * One step of a pipeline: an environment and, when that environment has more
 * than one gateway, the gateway marked as its default. A pipeline uses a given
 * environment at most once; stages are id-keyed (not environmentId-keyed) so
 * that constraint isn't baked into every consumer.
 */
export type PipelineStage = {
  id: string;
  environmentId: string;
  defaultGatewayId: string;
};

export type Pipeline = {
  id: string;
  name: string;
  stages: PipelineStage[];
};

export type CreatePipelineInput = {
  name: string;
  stages: PipelineStage[];
};

export type UpdatePipelineInput = CreatePipelineInput & {
  id: string;
};
