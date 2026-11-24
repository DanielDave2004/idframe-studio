import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { ArrowUpRight, ImagePlus, UploadCloud } from 'lucide-react'
import { validateImage } from '../lib/imageProcessing'

type Props = {
  onUpload: (file: File) => void
  onError: (message: string) => void
}

export default function PhotoUploader({ onUpload, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const acceptFile = (file?: File) => {
    if (!file) return
    const error = validateImage(file)
    if (error) return onError(error)
    onError('')
    onUpload(file)
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0])
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    acceptFile(event.dataTransfer.files[0])
  }

  return (
    <div className="upload-layout">
      <div className="upload-panel">
        <div
          className={`drop-zone ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
          onDrop={onDrop}
        >
          <div className="drop-illustration"><div className="photo-stack"><ImagePlus size={32} strokeWidth={1.5} /></div><span className="photo-sparkle">✳</span></div>
          <h2>Start with a photo</h2>
          <p>Drag and drop your image here, or browse files</p>
          <button type="button" className="primary-button" onClick={() => inputRef.current?.click()}>
            <UploadCloud size={18} /> Choose photo <ArrowUpRight size={16}/>
          </button>
          <small>JPG, PNG, WebP · Up to 12 MB</small>
          <input ref={inputRef} type="file" className="visually-hidden" accept="image/jpeg,image/png,image/webp" onChange={onChange} aria-label="Choose a photo to upload" />
        </div>
      </div>
    </div>
  )
}
