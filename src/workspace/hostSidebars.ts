import type { Workspace, WorkspaceLeaf, WorkspaceSidedock } from "obsidian";

interface SidebarSession {
  leaves: Set<WorkspaceLeaf>;
  sync: (leaf: WorkspaceLeaf | null) => void;
  dispose: () => void;
}
const sessions = new WeakMap<Workspace, SidebarSession>();

/** Share one temporary desktop layout across study tabs; the host keeps ownership of its docks. */
export function useStudySidebarSpace(workspace: Workspace, leaf: WorkspaceLeaf): () => void {
  const left = workspace.leftSplit, right = workspace.rightSplit;
  if (!left || !right || !("collapsed" in left) || !("collapsed" in right)) return () => {};
  let session = sessions.get(workspace);
  if (!session) {
    const docks: WorkspaceSidedock[] = [left, right];
    let before: boolean[] | null = null;
    let floatingHost: HTMLElement | null = null;
    const setFloatingHost = (current: WorkspaceLeaf | null) => {
      const next = current?.view.containerEl.ownerDocument.body ?? null;
      if (next === floatingHost) return;
      floatingHost?.classList.remove("ms-study-host-space");
      floatingHost = next;
      floatingHost?.classList.add("ms-study-host-space");
    };
    const restore = () => {
      setFloatingHost(null);
      if (!before) return;
      const states = before; before = null;
      docks.forEach((dock, index) => { if (dock.collapsed !== states[index]) { if (states[index]) dock.collapse(); else dock.expand(); } });
      workspace.requestSaveLayout();
    };
    const leaves = new Set<WorkspaceLeaf>();
    const sync = (active: WorkspaceLeaf | null) => {
      // Focusing an explicitly reopened Claudian/file sidebar is still part of studying.
      if (active && active.getRoot() !== workspace.rootSplit) return;
      const current = active ?? workspace.getMostRecentLeaf(workspace.rootSplit);
      if (current && leaves.has(current)) {
        setFloatingHost(current);
        if (before) return; // Respect a manual sidebar toggle until the next entry.
        before = docks.map(dock => dock.collapsed);
        docks.forEach(dock => { if (!dock.collapsed) dock.collapse(); });
        workspace.requestSaveLayout();
      } else restore();
    };
    const reference = workspace.on("active-leaf-change", sync);
    session = { leaves, sync, dispose: () => { workspace.offref(reference); restore(); } };
    sessions.set(workspace, session);
  }
  const owned = session;
  owned.leaves.add(leaf);
  owned.sync(workspace.getMostRecentLeaf(workspace.rootSplit));
  let released = false;
  workspace.onLayoutReady(() => { if (!released) owned.sync(workspace.getMostRecentLeaf(workspace.rootSplit)); });
  return () => {
    if (released) return; released = true;
    owned.leaves.delete(leaf);
    if (!owned.leaves.size) { owned.dispose(); sessions.delete(workspace); }
    else owned.sync(workspace.getMostRecentLeaf(workspace.rootSplit));
  };
}
