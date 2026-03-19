// =============================================================================
// Header - App header with title and optional game data upload
// =============================================================================

import { useRef } from "react";

interface HeaderProps {
  gameVersion?: string;
  onUploadGameData?: (file: File) => void;
}

export default function Header({ gameVersion, onUploadGameData }: HeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadGameData) {
      onUploadGameData(file);
    }
    // Reset input so the same file can be re-uploaded
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <header className="bg-gray-900 border-b border-gray-700 px-4 py-3 sm:px-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            MWI Combat Averagelator
          </h1>
          <span className="hidden sm:inline-block text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
            b{__APP_VERSION__}
          </span>
          {gameVersion && (
            <span className="hidden sm:inline-block text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
              game v{gameVersion}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onUploadGameData && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 border border-gray-600 px-3 py-1.5 rounded transition-colors cursor-pointer"
              >
                Upload Game Data
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
