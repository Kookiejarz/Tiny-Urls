import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { urlStorage } from './lib/db';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
  },
  {
    path: '/:shortPath',
    loader: async ({ params }) => {
      const url = await urlStorage.getUrl(params.shortPath!);
      if (url) {
        window.location.href = url.originalUrl.startsWith('http') 
          ? url.originalUrl 
          : `https://${url.originalUrl}`;
      } else {
        return null;
      }
    },
    element: <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Link not found</h1>
        <p className="text-gray-600">This shortened URL doesn't exist or has expired.</p>
        <a href="/" className="mt-4 inline-block text-indigo-600 hover:text-indigo-700">
          Create a new short link
        </a>
      </div>
    </div>,
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);