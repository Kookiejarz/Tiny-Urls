# URL Shortener

A modern, responsive URL shortening application built with React, TypeScript, and IndexedDB. Features include URL validation, custom expiration times, and animated UI elements.

## Features

- 🔗 Shorten long URLs to concise, easy-to-share links
- ⏰ Custom expiration options (12 hours, 7 days, or never)
- 🔄 Automatic duplicate URL detection
- 📋 One-click copy to clipboard
- 💫 Smooth animations and transitions
- 📱 Fully responsive design
- 🔒 Client-side storage using IndexedDB

## Tech Stack

- React
- TypeScript
- Framer Motion
- TailwindCSS
- IndexedDB (idb)
- React Router DOM

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/url-shortener.git
cd url-shortener
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

## Usage

1. Enter a URL in the input field
2. Select an expiration time (12 hours, 7 days, or forever)
3. Click "Shorten URL"
4. Copy the shortened URL to share

## Project Structure

```
src/
├── lib/
│   ├── db.ts         # IndexedDB setup and storage logic
│   └── utils.ts      # Utility functions
├── App.tsx           # Main application component
└── main.tsx         # Application entry point
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Icons provided by [Lucide Icons](https://lucide.dev/)
- Animations powered by [Framer Motion](https://www.framer.com/motion/)
- Styling with [TailwindCSS](https://tailwindcss.com/)