import Document, { Html, Head, Main, NextScript } from 'next/document';

class MyDocument extends Document {
  render() {
    return (
      <Html>
        <Head>
          <link rel="icon" href="/Risorsa_7c.svg" />
          <link 
            href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" 
            rel="stylesheet"
          />
          <title>Lead Extractor</title>
          <meta name="description" content="Your cold emailing tool" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;