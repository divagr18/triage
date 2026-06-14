import { FileCode2, Minus, Plus } from 'lucide-react'
import type { FileChange, PullRequest } from '../types'

interface Props {
  pr: PullRequest
}

function parsePatchLines(patch: string) {
  return patch.split('\n').map((line, i) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return { id: i, type: 'meta' as const, text: line }
    }
    if (line.startsWith('+')) return { id: i, type: 'add' as const, text: line }
    if (line.startsWith('-')) return { id: i, type: 'del' as const, text: line }
    return { id: i, type: 'ctx' as const, text: line }
  })
}

function FileDiff({ file }: { file: FileChange }) {
  const lines = parsePatchLines(file.patch || '')
  const hasPatch = lines.length > 0

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 size={14} className="shrink-0 text-zinc-500" />
          <span className="truncate text-xs font-medium text-zinc-200">{file.filename}</span>
          {file.previousFilename && file.previousFilename !== file.filename && (
            <span className="truncate text-xs text-zinc-600">from {file.previousFilename}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="flex items-center gap-1 text-emerald-400">
            <Plus size={12} />
            {file.additions}
          </span>
          <span className="flex items-center gap-1 text-red-400">
            <Minus size={12} />
            {file.deletions}
          </span>
        </div>
      </div>

      {hasPatch ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-[11px] leading-5">
            <tbody>
              {lines.map((line) => {
                const isMeta = line.type === 'meta'
                return (
                  <tr
                    key={line.id}
                    className={
                      line.type === 'add'
                        ? 'bg-emerald-500/5'
                        : line.type === 'del'
                          ? 'bg-red-500/5'
                          : isMeta
                            ? 'bg-zinc-900/80'
                            : 'hover:bg-zinc-900/40'
                    }
                  >
                    <td
                      className={`w-8 shrink-0 select-none border-r border-zinc-900 py-0.5 pr-2 pl-3 text-right text-[10px] ${
                        line.type === 'add'
                          ? 'text-emerald-500/60'
                          : line.type === 'del'
                            ? 'text-red-500/60'
                            : 'text-zinc-600'
                      }`}
                    >
                      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : isMeta ? '...' : ''}
                    </td>
                    <td
                      className={`whitespace-pre py-0.5 pl-3 ${
                        line.type === 'add'
                          ? 'text-emerald-300'
                          : line.type === 'del'
                            ? 'text-red-300'
                            : isMeta
                              ? 'text-zinc-500'
                              : 'text-zinc-400'
                      }`}
                    >
                      {isMeta ? line.text : line.text.slice(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-zinc-600">No patch available.</div>
      )}
    </div>
  )
}

export function PrDiff({ pr }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}
        </span>
        <span className="font-mono">
          <span className="text-emerald-400">+{pr.additions}</span>
          {' / '}
          <span className="text-red-400">-{pr.deletions}</span>
        </span>
      </div>
      {pr.files.map((file) => (
        <FileDiff key={file.filename} file={file} />
      ))}
    </div>
  )
}
