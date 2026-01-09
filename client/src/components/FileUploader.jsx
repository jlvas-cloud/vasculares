import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, FileImage, FileText } from 'lucide-react';
import { Button } from './ui/button';

/**
 * FileUploader component with drag & drop support
 * Uses react-dropzone for file handling
 */
export default function FileUploader({ files, onFilesChange, disabled }) {
  const onDrop = useCallback((acceptedFiles) => {
    // Add new files to existing files
    onFilesChange([...files, ...acceptedFiles]);
  }, [files, onFilesChange]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'application/pdf': ['.pdf']
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 10,
    disabled
  });

  const removeFile = (index) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    onFilesChange(newFiles);
  };

  const getFileIcon = (file) => {
    if (file.type === 'application/pdf') {
      return <FileText className="h-4 w-4 text-red-500" />;
    }
    return <FileImage className="h-4 w-4 text-blue-500" />;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
        {isDragActive ? (
          <p className="text-primary font-medium">Suelta los archivos aqui...</p>
        ) : (
          <>
            <p className="text-muted-foreground mb-2">
              Arrastra imagenes o PDFs aqui
            </p>
            <p className="text-sm text-muted-foreground">
              o haz clic para seleccionar
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Formatos: JPG, PNG, GIF, WEBP, PDF (max. 10MB c/u)
            </p>
          </>
        )}
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Archivos seleccionados ({files.length})
          </p>
          <div className="space-y-1">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {getFileIcon(file)}
                  <span className="text-sm truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({formatFileSize(file.size)})
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(index)}
                  disabled={disabled}
                  className="h-6 w-6 p-0 shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
