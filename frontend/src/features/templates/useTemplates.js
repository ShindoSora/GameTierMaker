(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function useTemplates({ setLoading, confirmAction }) {
    const [templates, setTemplates] = useState([]);
    const [currentId, setCurrentId] = useState(null);
    const [contentTemplateId, setContentTemplateId] = useState(null);
    const [tiers, setTiers] = useState([]);
    const [unassigned, setUnassigned] = useState([]);
    const [libraryGroups, setLibraryGroups] = useState([]);
    const [imagesMeta, setImagesMeta] = useState({});
    const [templateName, setTemplateName] = useState('');
    const [renameMode, setRenameMode] = useState(false);
    const [templateDeletion, setTemplateDeletion] = useState(null);
    const [creatingTemplate, setCreatingTemplate] = useState(false);
    // Async platform callbacks read the latest template through a narrow capability.
    const latestTemplateRef = useRef({});
    const getCurrentTemplate = () => latestTemplateRef.current;
    const recoveryNoticeShownRef = useRef(false);
    const templateLoadSequenceRef = useRef(0);
    const templateDataSequenceRef = useRef(0);
    const selectedTemplateRef = useRef(null);
    const templateSwitchQueueRef = useRef(Promise.resolve());
    const templateCreateInFlightRef = useRef(false);
    const templateDeletionRef = useRef(null);
    const templateDeletionSequenceRef = useRef(0);
    useEffect(() => {
      latestTemplateRef.current = {
        currentId,
        loadCurrentTemplate,
      };
    });
    useEffect(
      () => () => {
        templateLoadSequenceRef.current += 1;
        templateDataSequenceRef.current += 1;
        selectedTemplateRef.current = null;
        latestTemplateRef.current = {};
        templateDeletionRef.current = null;
        templateCreateInFlightRef.current = false;
      },
      []
    );
    const loadData = async (preferredTemplateId = null, { quiet = false } = {}) => {
      const dataSequence = ++templateDataSequenceRef.current;
      try {
        if (!quiet) setLoading(true);
        const projectStatus = await fetchAPI('/project/status');
        if (projectStatus.status === 'recovery_required') {
          const resetConfirmed = await confirmAction(t('dialogs.recoveryReset'));
          if (!resetConfirmed) {
            showToast(t('project.recoveryProtected'), 'error');
            return;
          }
          await fetchAPI('/project/reset', {
            method: 'POST',
            body: JSON.stringify({
              confirm: true,
            }),
          });
          showToast(t('project.resetAfterRecovery'), 'success');
        } else if (projectStatus.recovered && !recoveryNoticeShownRef.current) {
          recoveryNoticeShownRef.current = true;
          showToast(t('project.recovered'), 'success');
        }
        const tmps = await fetchAPI('/templates');
        if (dataSequence !== templateDataSequenceRef.current) return;
        setTemplates(tmps);
        if (tmps.length > 0) {
          const cur =
            tmps.find((t) => t.id === preferredTemplateId) ||
            tmps.find((t) => t.id === selectedTemplateRef.current) ||
            tmps.find((t) => t.is_current) ||
            tmps.find((t) => t.id === currentId) ||
            tmps[0];
          selectedTemplateRef.current = cur.id;
          setCurrentId(cur.id);
          return await loadCurrentTemplate(cur.id);
        }
      } catch (e) {
        console.error(e);
        showToast(getErrorMessage(e, 'errors.backendUnavailable'), 'error');
      } finally {
        if (!quiet) setLoading(false);
      }
      return false;
    };
    const loadCurrentTemplate = async (tid) => {
      if (!tid || (selectedTemplateRef.current && selectedTemplateRef.current !== tid))
        return false;
      const sequence = ++templateLoadSequenceRef.current;
      const snapshot = await fetchAPI(`/templates/${encodeURIComponent(tid)}/snapshot`);
      if (sequence !== templateLoadSequenceRef.current || selectedTemplateRef.current !== tid)
        return false;
      setTiers(snapshot.tiers || []);
      setUnassigned(snapshot.unassigned?.image_ids || []);
      setLibraryGroups(snapshot.groups || []);
      setImagesMeta(snapshot.images_meta || {});
      setTemplateName(snapshot.template?.name || '');
      setContentTemplateId(tid);
      return true;
    };
    const refreshSelectedTemplate = async () => {
      const activeTemplateId = selectedTemplateRef.current;
      if (activeTemplateId) await loadCurrentTemplate(activeTemplateId);
    };
    const switchTemplate = async (tid) => {
      if (!tid || selectedTemplateRef.current === tid || templateDeletionRef.current || templateCreateInFlightRef.current) return;
      setRenameMode(false);
      selectedTemplateRef.current = tid;
      templateDataSequenceRef.current += 1;
      templateLoadSequenceRef.current += 1;
      setCurrentId(tid);
      const operation = templateSwitchQueueRef.current
        .catch(() => {})
        .then(async () => {
          await fetchAPI(`/templates/${encodeURIComponent(tid)}/switch`, {
            method: 'PUT',
          });
          if (selectedTemplateRef.current !== tid) return false;
          return loadCurrentTemplate(tid);
        });
      templateSwitchQueueRef.current = operation.catch(() => {});
      try {
        await operation;
      } catch (error) {
        if (selectedTemplateRef.current === tid) {
          selectedTemplateRef.current = null;
          showToast(getErrorMessage(error, 'errors.requestFailed'), 'error');
          await loadData();
        }
      }
    };
    const handleCreateTemplate = async () => {
      if (templateCreateInFlightRef.current || templateDeletionRef.current) return;
      templateCreateInFlightRef.current = true;
      setCreatingTemplate(true);
      setRenameMode(false);
      templateDataSequenceRef.current += 1;
      templateLoadSequenceRef.current += 1;
      try {
        const res = await fetchAPI('/templates', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (!templateCreateInFlightRef.current) return;
        // Creation already selects and appends the template on the server.
        // Read only its render snapshot instead of reloading project status/list.
        setTemplates(items => items.filter(item => item.id !== res.id)
          .map(item => ({ ...item, is_current: false })).concat({ ...res, is_current: true }));
        selectedTemplateRef.current = res.id;
        setCurrentId(res.id);
        if (await loadCurrentTemplate(res.id)) showToast(t('template.created'), 'success');
      } catch (error) {
        if (templateCreateInFlightRef.current) showToast(getErrorMessage(error, 'errors.createFailed'), 'error');
      } finally {
        templateCreateInFlightRef.current = false;
        setCreatingTemplate(false);
      }
    };
    const finishTemplateDeletion = (id) => {
      if (templateDeletionRef.current?.id !== id) return;
      templateDeletionRef.current = null;
      setTemplateDeletion(null);
    };
    const updateDeletion = (operation, phase) => {
      if (templateDeletionRef.current !== operation) return;
      operation.phase = phase;
      setTemplateDeletion({ ...operation });
    };
    const loadDeletionReplacement = async (operation) => {
      const loaded = await loadData(operation.replacementId, { quiet: true });
      updateDeletion(operation, loaded ? 'ready' : 'error');
    };
    const retryTemplateDeletion = async () => {
      const operation = templateDeletionRef.current;
      if (operation?.phase !== 'error') return;
      updateDeletion(operation, 'consuming');
      await loadDeletionReplacement(operation);
    };
    const handleDeleteTemplate = async () => {
      const targetTemplateId = currentId;
      if (!targetTemplateId || contentTemplateId !== targetTemplateId || templateDeletionRef.current || templateCreateInFlightRef.current) return;
      // Lock before confirmation too: repeated clicks must never send two DELETEs.
      const operation = { id: ++templateDeletionSequenceRef.current, fromId: targetTemplateId, phase: 'confirming' };
      templateDeletionRef.current = operation;
      try {
        if (!(await confirmAction(t('dialogs.deleteTemplate'))) || selectedTemplateRef.current !== targetTemplateId) {
          finishTemplateDeletion(operation.id);
          return;
        }
        setRenameMode(false);
        updateDeletion(operation, 'consuming');
        templateLoadSequenceRef.current += 1;
        const result = await fetchAPI(`/templates/${encodeURIComponent(targetTemplateId)}`, { method: 'DELETE' });
        if (templateDeletionRef.current !== operation) return;
        // The backend chooses the first remaining template, or creates one if empty.
        operation.replacementId = result.current_template_id;
        selectedTemplateRef.current = operation.replacementId;
        setCurrentId(operation.replacementId);
        await loadDeletionReplacement(operation);
      } catch (error) {
        showToast(getErrorMessage(error, 'errors.requestFailed'), 'error');
        updateDeletion(operation, 'cancelled');
      }
    };
    const handleRenameTemplate = async (draft = templateName) => {
      const name = draft.trim(), targetId = currentId;
      const targetSequence = templateLoadSequenceRef.current;
      if (!name || !targetId || templateDeletionRef.current || templateCreateInFlightRef.current) return false;
      try {
        await fetchAPI(`/templates/${encodeURIComponent(targetId)}/rename`, {
          method: 'PUT',
          body: JSON.stringify({ name }),
        });
        // Renaming only changes the name, so keep the board and editor mounted.
        setTemplates(items => items.map(item => item.id === targetId ? { ...item, name } : item));
        if (selectedTemplateRef.current === targetId) {
          setTemplateName(name);
          if (templateLoadSequenceRef.current === targetSequence) setRenameMode(false);
        }
        return true;
      } catch (error) {
        showToast(getErrorMessage(error, 'errors.requestFailed'), 'error');
        return false;
      }
    };
    return {
      templates,
      currentId,
      contentTemplateId,
      creatingTemplate,
      templateDeletion,
      finishTemplateDeletion,
      retryTemplateDeletion,
      tiers,
      unassigned,
      libraryGroups,
      imagesMeta,
      templateName,
      setTemplateName,
      renameMode,
      setRenameMode,
      getCurrentTemplate,
      loadData,
      loadCurrentTemplate,
      refreshSelectedTemplate,
      switchTemplate,
      handleCreateTemplate,
      handleDeleteTemplate,
      handleRenameTemplate,
    };
  }
  Object.assign(window.GameTierApp, {
    useTemplates,
  });
})();
