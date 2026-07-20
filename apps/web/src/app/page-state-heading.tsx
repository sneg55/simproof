import { DocumentTitle } from '@/app/document-title'

export function PageStateHeading({
  documentTitle,
  children,
}: {
  readonly documentTitle: string
  readonly children: string
}) {
  return (
    <>
      <DocumentTitle value={`${documentTitle} | SimProof`} />
      <h1 className="text-page-title font-heading font-semibold tracking-tight">{children}</h1>
    </>
  )
}
