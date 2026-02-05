import Downloader from './components/Downloader';
import ThemeToggle from './components/ThemeToggle';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            YouTube Video Downloader
          </h1>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 md:p-8">
          <Downloader />
        </div>

        {/* Footer Info */}
        <div className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>
            Free YouTube video downloader. Select your preferred quality and format.
          </p>
          <p className="mt-2">
            Note: Downloads are processed in your browser. Large videos may take time to merge.
          </p>
        </div>
      </div>
    </main>
  );
}

