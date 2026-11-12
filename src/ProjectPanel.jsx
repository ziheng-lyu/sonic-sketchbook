import React from 'react';

export function ProjectPanel({ project, projects, status, working, onName, onSave, onNew, onOpen, onExport, onImport, onClose }) {
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
      {projects.map(item => <button key={item.id} disabled={working} aria-label={`Open project ${item.name}`}
        aria-current={item.id === project.id ? 'true' : undefined} onClick={() => onOpen(item.id)}>{item.name}</button>)}
    </div>}
    <p className="project-note">Saved in this browser. Export a file for backup.</p>
  </section>;
}
