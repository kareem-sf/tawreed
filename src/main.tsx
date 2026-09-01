import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './i18n';

const theme = createTheme({
  primaryColor: 'gold',
  autoContrast: true,
  colors: {
    gold: [
      '#fdf6e8',
      '#f8e8c4',
      '#f3d69a',
      '#eec473',
      '#eab659',
      '#e8b54a',
      '#d19f3c',
      '#9a6700',
      '#7a5200',
      '#5c3e00',
    ],
  },
  fontFamily: 'Public Sans, Segoe UI, system-ui, sans-serif',
  headings: { fontFamily: 'Domine, Segoe UI, system-ui, serif' },
  defaultRadius: 'md',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MantineProvider>
  </React.StrictMode>
);
