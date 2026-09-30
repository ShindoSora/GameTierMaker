(() => {
  'use strict';

  const { useState, useRef, useEffect } = React;
  const { t, getErrorMessage } = window.GameTierI18n;
  const { fetchAPI, showToast } = window.GameTierApp;
  function useTemplates({ setLoading, confirmAction }) {
    const [templates, setTemplates] = useState([]);
    const [currentId, setCurrentId] = useState(null);
    const [tiers, setTiers] = useState([]);
    const [unassigned, setUnassigned] = useState([]);
    const [libraryGroups, setLibraryGroups] = useState([]);
    const [imagesMeta, setImagesMeta] = useState({});
    const [templateName, setTemplateName] = useState('');
    const [renameMode, setRenameMode] = useState(false);
    // Async platform callbacks read the latest template through a narrow capability.
    const latestTemplateRef = useRef({});
    const getCurrentTemplate = () => latestTemplateRef.current;
    const recoveryNoticeShownRef = useRef(false);
    const templateLoadSequenceRef = useRef(0);
    const templateDataSequenceRef = useRef(0);
    const selectedTemplateRef = useRef(null);
    const templateSwitchQueueRef = useRef(Promise.resolve());
    const templateCreateInFlightRef = useRef(false);
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
      },
      []
    );
    const loadData = async (preferredTemplateId = null) => {
      const dataSequence = ++templateDataSequenceRef.current;
      try {
        setLoading(true);
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
          await loadCurrentTemplate(cur.id);
        }
      } catch (e) {
        console.error(e);
        showToast(getErrorMessage(e, 'errors.backendUnavailable'), 'error');
      } finally {
        setLoading(false);
      }
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
      return true;
    };
    const refreshSelectedTemplate = async () => {
      const activeTemplateId = selectedTemplateRef.current;
      if (activeTemplateId) await loadCurrentTemplate(activeTemplateId);
    };
    const switchTemplate = async (tid) => {
      if (!tid || selectedTemplateRef.current === tid) return;
      setRenameMode(false);
      selectedTemplateRef.current = tid;
      templateDataSequenceRef.current += 1;
      templateLoadSequenceRef.current += 1;
      setCurrentId(tid);
      setLoading(true);
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
      } finally {
        setLoading(false);
      }
    };
    const handleCreateTemplate = async () => {
      if (templateCreateInFlightRef.current) return;
      templateCreateInFlightRef.current = true;
      setLoading(true);
      try {
        const res = await fetchAPI('/templates', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        selectedTemplateRef.current = res.id;
        setCurrentId(res.id);
        await loadData(res.id);
        showToast(t('template.created'), 'success');
      } catch (error) {
        showToast(getErrorMessage(error, 'errors.createFailed'), 'error');
      } finally {
        templateCreateInFlightRef.current = false;
        setLoading(false);
      }
    };
    const handleDeleteTemplate = async () => {
      const targetTemplateId = currentId;
      if (!targetTemplateId || !(await confirmAction(t('dialogs.deleteTemplate')))) return;
      await fetchAPI(`/templates/${targetTemplateId}`, {
        method: 'DELETE',
      });
      await loadData();
    };
    const handleRenameTemplate = async () => {
      if (!templateName.trim() || !currentId) return;
      await fetchAPI(`/templates/${currentId}/rename`, {
        method: 'PUT',
        body: JSON.stringify({
          name: templateName.trim(),
        }),
      });
      await loadData();
      setRenameMode(false);
    };
    return {
      templates,
      currentId,
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
