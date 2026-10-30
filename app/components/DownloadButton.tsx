'use client';

export default function DownloadButton({
  content,
  filename,
  label = 'Download .lua',
}: {
  content: string;
  filename: string;
  label?: string;
}) {
  function download() {
    const blob = new Blob([content], { type: 'text/x-lua;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="btn" type="button" onClick={download}>
      {label}
    </button>
  );
}
