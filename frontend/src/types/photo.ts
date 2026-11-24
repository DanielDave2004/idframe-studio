export type Background = 'white' | 'blue' | 'gray'
export type Format = 'png' | 'jpeg'

export type PixelCrop = {
  x: number
  y: number
  width: number
  height: number
}

export const BACKGROUNDS: Record<Background, string> = {
  white: '#ffffff',
  blue: '#dcecf9',
  gray: '#e5e7eb',
}
