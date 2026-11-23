declare module 'troika-three-text' {
  import { Mesh, ColorRepresentation } from 'three'

  export interface TextAnchor {
    align?: 'left' | 'right' | 'center' | 'justify'
  }

  export class Text extends Mesh {
    text: string
    fontSize: number
    color: ColorRepresentation
    outlineWidth?: number | string
    outlineColor?: ColorRepresentation
    anchorX: 'left' | 'center' | 'right' | number
    anchorY: 'top' | 'middle' | 'bottom' | number
    maxWidth?: number
    lineHeight?: number
    textAlign?: TextAnchor['align']
    sync: (callback?: () => void) => void
    dispose: () => void
  }
}
