import { z } from 'zod'

const libraryRouteNoticeSchema = z
  .object({
    kind: z.literal('library-operation'),
    operation: z.enum(['archive', 'delete']),
    title: z.string().trim().min(1).max(120),
  })
  .strict()

export type LibraryRouteNotice = z.infer<typeof libraryRouteNoticeSchema>

export function libraryRouteNotice(
  operation: LibraryRouteNotice['operation'],
  title: string,
): LibraryRouteNotice {
  return libraryRouteNoticeSchema.parse({ kind: 'library-operation', operation, title })
}

export function parseLibraryRouteNotice(value: unknown): LibraryRouteNotice | null {
  const parsed = libraryRouteNoticeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function libraryRouteNoticeMessage(notice: LibraryRouteNotice): string {
  return notice.operation === 'archive' ? `Archived ${notice.title}` : `Deleted ${notice.title}`
}
