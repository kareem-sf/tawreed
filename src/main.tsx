import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './i18n';

const theme = createTheme({
  primaryColor: 'yellow',
  fontFamily: 'Segoe UI, Inter, system-ui, sans-serif',
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
