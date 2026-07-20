export interface DownloadPort {
  save(file: {
    readonly content: string
    readonly fileName: string
    readonly mediaType: string
  }): void
}

export const browserDownloadPort: DownloadPort = {
  save: ({ content, fileName, mediaType }) => {
    const url = URL.createObjectURL(new Blob([content], { type: mediaType }))
    const link = document.createElement('a')
    link.download = fileName
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  },
}
