export interface GlassShape {
  width: number
  height: number
  radius: number
}

export interface GlassGeometry extends GlassShape {
  edgeWidth: number
  strength: number
}

interface Size { width: number; height: number }
interface Rect extends Size { left: number; top: number }

/** Signed distance and outward normal of a rounded rectangle, in CSS pixels. */
export function roundedRectSample(x: number, y: number, shape: GlassShape) {
  const radius = Math.max(0, Math.min(shape.radius, shape.width / 2, shape.height / 2))
  const px = x - shape.width / 2
  const py = y - shape.height / 2
  const qx = Math.abs(px) - (shape.width / 2 - radius)
  const qy = Math.abs(py) - (shape.height / 2 - radius)
  const outsideX = Math.max(qx, 0)
  const outsideY = Math.max(qy, 0)
  const outsideLength = Math.hypot(outsideX, outsideY)
  const signX = px < 0 ? -1 : 1
  const signY = py < 0 ? -1 : 1
  return {
    distance: outsideLength + Math.min(Math.max(qx, qy), 0) - radius,
    normalX: outsideLength > 0 ? signX * outsideX / outsideLength : qx > qy ? signX : 0,
    normalY: outsideLength > 0 ? signY * outsideY / outsideLength : qx > qy ? 0 : signY,
  }
}

/** The clear core never bends. A smooth lens profile bends only the inner edge. */
export function sampleGlassDisplacement(x: number, y: number, geometry: GlassGeometry) {
  const sample = roundedRectSample(x, y, geometry)
  const depth = -sample.distance
  if (depth <= 0 || depth >= geometry.edgeWidth || geometry.edgeWidth <= 0 || geometry.strength <= 0) {
    return { x: 0, y: 0 }
  }
  const bend = Math.sin(Math.PI * depth / geometry.edgeWidth) * geometry.strength
  return {
    x: sample.normalX === 0 ? 0 : -sample.normalX * bend,
    y: sample.normalY === 0 ? 0 : -sample.normalY * bend,
  }
}

/** RG channels encode displacement, not a screenshot; no page pixels enter canvas. */
export function createGlassDisplacementMap(geometry: GlassGeometry) {
  const width = Math.max(1, Math.min(1024, Math.ceil(geometry.width)))
  const height = Math.max(1, Math.min(512, Math.ceil(geometry.height)))
  const strength = Math.max(0, geometry.strength)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const displacement = sampleGlassDisplacement(
        (x + .5) * geometry.width / width,
        (y + .5) * geometry.height / height,
        geometry,
      )
      const offset = (y * width + x) * 4
      data[offset] = strength > 0 ? Math.round(127.5 + displacement.x / strength * 127.5) : 128
      data[offset + 1] = strength > 0 ? Math.round(127.5 + displacement.y / strength * 127.5) : 128
      data[offset + 2] = 128
      data[offset + 3] = 255
    }
  }
  return { width, height, data, scale: strength * 2 }
}

const positiveRatio = (numerator: number, denominator: number) =>
  numerator > 0 && denominator > 0 ? numerator / denominator : 1

/** Reverse the lens' live scale so the duplicated page retains its screen position. */
export function glassSourceTransform(source: Rect, surface: Rect, surfaceSize: Size, sourceSize: Size) {
  const surfaceScaleX = positiveRatio(surface.width, surfaceSize.width)
  const surfaceScaleY = positiveRatio(surface.height, surfaceSize.height)
  return {
    x: (source.left - surface.left) / surfaceScaleX,
    y: (source.top - surface.top) / surfaceScaleY,
    scaleX: positiveRatio(source.width, sourceSize.width) / surfaceScaleX,
    scaleY: positiveRatio(source.height, sourceSize.height) / surfaceScaleY,
  }
}

const OMIT_FROM_GLASS = '.modal-backdrop, dialog, [role="dialog"], script, style, link, iframe, object, embed, video, audio, source, track, .fab, [data-glass-refraction]'

/** Clone current DOM once per page change; never mount a second business component. */
export function cloneGlassSource(source: HTMLElement, idPrefix: string, scrollMirrors?: Map<Element, Element>): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  // Pair before pruning, so excluded dialogs cannot shift the correspondence.
  if (scrollMirrors) {
    scrollMirrors.clear()
    const sourceElements = [source, ...source.querySelectorAll('*')]
    const cloneElements = [clone, ...clone.querySelectorAll('*')]
    sourceElements.forEach((element, index) => scrollMirrors.set(element, cloneElements[index]))
  }
  clone.querySelectorAll(OMIT_FROM_GLASS).forEach((element) => element.remove())
  if (scrollMirrors) {
    for (const [element, mirror] of scrollMirrors) {
      if (!clone.contains(mirror)) scrollMirrors.delete(element)
    }
  }
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  for (const input of clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if (input.getAttribute('type') === 'password' || input.getAttribute('type') === 'file'
      || /password|token|secret|authorization/i.test(`${input.name} ${input.id} ${input.autocomplete}`)) {
      input.value = ''
      input.removeAttribute('value')
      if (input instanceof HTMLTextAreaElement) input.textContent = ''
    }
  }
  const prefix = idPrefix.replace(/[^\w-]/g, '') || 'glass'
  const elements = [clone, ...clone.querySelectorAll('*')]
  const ids = new Map<string, string>()
  const svgIds = new Map<Element, Map<string, string>>()
  let sequence = 0
  for (const element of elements) {
    if (!element.id) continue
    const oldId = element.id
    const newId = `${prefix}-node-${sequence++}`
    if (!ids.has(oldId)) ids.set(oldId, newId)
    const svg = element.closest('svg')
    if (svg) {
      const scope = svgIds.get(svg) ?? new Map<string, string>()
      if (!scope.has(oldId)) scope.set(oldId, newId)
      svgIds.set(svg, scope)
    }
    element.id = newId
  }
  for (const element of elements) {
    const svg = element.closest('svg')
    const resolve = (id: string) => (svg && svgIds.get(svg)?.get(id)) || ids.get(id) || id
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || attribute.name === 'autofocus') {
        element.removeAttribute(attribute.name)
        continue
      }
      let value = attribute.value.replace(/url\(\s*(['"]?)#([^\s)'";]+)\1\s*\)/gi, (_match, _quote, id: string) => `url(#${resolve(id)})`)
      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value.startsWith('#')) {
        value = `#${resolve(value.slice(1))}`
      }
      if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby' || attribute.name === 'for') {
        value = value.split(/\s+/).map(resolve).join(' ')
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    }
  }
  return clone
}
