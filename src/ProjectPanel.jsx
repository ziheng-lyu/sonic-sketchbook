import React from 'react';

export function ProjectPanel({ project, projects, status, working, onName, onSave, onNew, onOpen, onExport, onImport, onDelete, deleted, onRestore, onClose }) {
  return <section className="project-panel" role="dialog" aria-label="Projects">
    <div className="project-heading"><span>Projects</span><button className="small-close" aria-label="Close projects" onClick={onClose}>×</button></div>
    <input className="project-name" aria-label="Project name" maxLength={120} value={project.name} disabled={working}
      onChange={event => onName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onSave(); } }} />
    <div className="project-actions">
      <button aria-label="Save project" disabled={working} onClick={onSave}>Save</button>
      <button aria-label="New project" disabled={working} onClick={onNew}>New</button>
      <button aria-label="Export project file" disabled={working} onClick={onExport}>Export</button>
      <button aria-label="Import project file" disabled={working} onClick={onImport}>Import</button>
    </div>
    <p className="project-status" role="status">{status}</p>
    {!!projects.length && <div className="project-list" aria-label="Saved projects">
      {projects.map(item => <div className="project-row" key={item.id}>
        <button className="project-open" disabled={working} aria-label={`Open project ${item.name}`}
          aria-current={item.id === project.id ? 'true' : undefined} onClick={() => onOpen(item.id)}>{item.name}</button>
        <button className="project-delete" disabled={working} aria-label={`Delete project ${item.name}`} onClick={() => onDelete(item.id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
          </svg>
        </button>
      </div>)}
    </div>}
    {deleted && <p className="project-recovery" role="status"><span>Deleted “{deleted.metadata.name}”</span><button disabled={working} aria-label="Undo project deletion" onClick={onRestore}>Undo</button></p>}
    <p className="project-note">Saved in this browser. Export a file for backup.</p>
  </section>;
}
