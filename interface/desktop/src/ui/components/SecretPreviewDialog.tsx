type SecretPreviewDialogProps = {
  secretPath: string | null
  previewText: string | null
  onClose: () => void
}

export function SecretPreviewDialog ({ secretPath, previewText, onClose }: SecretPreviewDialogProps) {
  if (!secretPath || previewText === null) {
    return null
  }

  return (
    <section className='dialog-card' aria-label='Secret preview'>
      <h3 className='status-card__label'>Secret Preview</h3>
      <p className='route-copy'>This decrypted preview is in-memory only (ephemeral) and is never auto-saved.</p>
      <p className='field-label'>Path: {secretPath}</p>
      <pre className='secret-preview'>{previewText}</pre>
      <button type='button' className='sidebar__link' onClick={onClose}>Close Preview</button>
    </section>
  )
}
