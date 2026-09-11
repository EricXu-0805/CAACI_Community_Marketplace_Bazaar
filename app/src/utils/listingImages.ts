import type { ImageDim } from '../types'

/** Replace successful local uploads in place; failed photos alone are omitted. */
export function mergeListingImages(
  selected: string[],
  selectedDimensions: ImageDim[],
  uploaded: { urls: string[]; dims: ImageDim[]; sourceIndices: number[] },
): { images: string[]; imageDimensions: ImageDim[] } {
  const images: string[] = []
  const imageDimensions: ImageDim[] = []
  const uploadedBySource = new Map(uploaded.sourceIndices.map((source, result) => [source, result]))
  let localIndex = 0
  for (const [index, source] of selected.entries()) {
    let url = source
    let dim = selectedDimensions[index]
    if (!source.startsWith('http')) {
      const result = uploadedBySource.get(localIndex++)
      if (result === undefined) continue
      url = uploaded.urls[result]
      dim = uploaded.dims[result]
    }
    images.push(url)
    imageDimensions.push(dim && dim.w > 0 && dim.h > 0 ? dim : { w: 0, h: 0 })
  }
  return { images, imageDimensions }
}
