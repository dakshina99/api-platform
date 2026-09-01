/*
 * Copyright (c) 2026, WSO2 LLC (http://www.wso2.com). All Rights Reserved.
 *
 * This software is the property of WSO2 LLC and its suppliers, if any.
 * Dissemination of any information or reproduction of any material contained
 * herein in any form is strictly forbidden, unless permitted by WSO2 expressly.
 * You may not alter or remove any copyright or other notice from copies of this content.
 */

import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { Box, Button, CircularProgress, Typography } from '@wso2/oxygen-ui';
import PipelineCreatePage from './PipelineCreatePage';
import PipelinesListPage from './PipelinesListPage';
import { createRestPipelinePort } from './dataPort';
import type { AIWorkspaceHostPort } from './hostPort';
import type { CreatePipelineInput, Environment, Pipeline } from './types';

export type PipelinesFeatureProps = {
  port: AIWorkspaceHostPort;
};

/**
 * The extension's `render(port)` result: an organization-scoped list/create/edit
 * flow over the platform-api deployment pipelines, switching view with local
 * state rather than a nested route. Data flows through the host-injected
 * `apiFetch` via `createRestPipelinePort` — the component never sees a token or
 * a URL.
 */
const PipelinesFeature: FC<PipelinesFeatureProps> = ({ port }) => {
  const dataPort = useMemo(() => createRestPipelinePort(port.apiFetch), [port.apiFetch]);

  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loadedEnvironments = await dataPort.listEnvironments();
      const loadedPipelines = await dataPort.listPipelines(loadedEnvironments);
      setEnvironments(loadedEnvironments);
      setPipelines(loadedPipelines);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load deployment pipelines.');
    } finally {
      setLoading(false);
    }
  }, [dataPort]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (input: CreatePipelineInput, pipelineId?: string) => {
    try {
      if (pipelineId) {
        await dataPort.updatePipeline({ ...input, id: pipelineId }, environments);
        port.notify(`Pipeline "${input.name}" updated.`, 'success');
      } else {
        await dataPort.createPipeline(input, environments);
        port.notify(`Pipeline "${input.name}" created.`, 'success');
      }
      setView('list');
      setEditingPipelineId(null);
      await load();
    } catch (submitError) {
      port.notify(
        submitError instanceof Error ? submitError.message : 'Unable to save the pipeline.',
        'error'
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await dataPort.deletePipeline(id);
      port.notify('Pipeline deleted.', 'success');
      await load();
    } catch (deleteError) {
      port.notify(
        deleteError instanceof Error ? deleteError.message : 'Unable to delete the pipeline.',
        'error'
      );
    }
  };

  const handleEditClick = (id: string) => {
    setEditingPipelineId(id);
    setView('edit');
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1.5,
          py: 6,
          px: 3,
          textAlign: 'center',
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {error}
        </Typography>
        <Button variant="outlined" size="small" onClick={() => void load()}>
          Retry
        </Button>
      </Box>
    );
  }

  if (view === 'create' || view === 'edit') {
    const editingPipeline =
      view === 'edit' ? pipelines.find((pipeline) => pipeline.id === editingPipelineId) : undefined;
    return (
      <PipelineCreatePage
        environments={environments}
        mode={view}
        initialPipeline={editingPipeline}
        onBack={() => {
          setView('list');
          setEditingPipelineId(null);
        }}
        onSubmit={handleSubmit}
      />
    );
  }

  return (
    <PipelinesListPage
      pipelines={pipelines}
      environments={environments}
      onCreateClick={() => setView('create')}
      onEditClick={handleEditClick}
      onDelete={handleDelete}
    />
  );
};

export default PipelinesFeature;
