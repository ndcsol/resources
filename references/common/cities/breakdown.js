import { readFile, writeFile, unlink } from 'fs/promises';
import { createReadStream } from 'fs'
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHUNK_SIZE = 1000;

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }

  result.push(current);
  return result;
}

function escapeCSVField(field) {
  if (field == null) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

async function parseMetaCSV(filePath) {
  const csvContent = await readFile(filePath, 'utf8');
  const lines = csvContent.trim().split('\n');
  const files = lines.slice(1).filter(line => line.trim()).map(line => line.trim());
  return files;
}

function groupFilesByCountry(files) {
  const groups = {};

  files.forEach(fileName => {
    const baseName = fileName.replace(/\.csv$/, '');
    const countryName = baseName.replace(/-\d+$/, '');

    if (!groups[countryName]) {
      groups[countryName] = [];
    }
    groups[countryName].push(fileName);
  });

  return groups;
}

async function combineCountryFiles(countryFiles, countryName) {
  let allData = [];
  let columnNames = [];

  const filesToDelete = [];

  for (const fileName of countryFiles) {
    const filePath = join(__dirname, fileName);
    try {
      const csvContent = await readFile(filePath, 'utf8');
      const lines = csvContent.trim().split('\n');

      if (lines.length === 0) continue;

      if (columnNames.length === 0) {
        columnNames = parseCSVLine(lines[0]);
      }

      const dataLines = lines.slice(1);
      const fileData = dataLines.map(line => {
        const values = parseCSVLine(line);
        const dataObject = {};
        columnNames.forEach((columnName, index) => {
          dataObject[columnName] = values[index] || '';
        });
        return dataObject;
      });

      allData = allData.concat(fileData);
      filesToDelete.push(fileName);
      console.log(`Combined ${fileName}: ${fileData.length} rows`);
    } catch (error) {
      console.error(`Error reading ${fileName}:`, error.message);
    }
  }

  // Delete original files immediately after combining
  for (const fileName of filesToDelete) {
    try {
      const filePath = join(__dirname, fileName);
      await unlink(filePath);
      console.log(`Deleted original file: ${fileName}`);
    } catch (error) {
      console.error(`Error deleting ${fileName}:`, error.message);
    }
  }

  return { data: allData, columnNames };
}

async function processCountryInChunks(countryName, countryFiles, createdFiles) {
  console.log(`\nProcessing ${countryName} (${countryFiles.length} files)...`);

  const { data: allData, columnNames } = await combineCountryFiles(countryFiles, countryName);

  if (allData.length === 0) {
    console.log(`No data found for ${countryName}`);
    return;
  }

  const writeChunk = async (chunk, chunkNum) => {
    if (chunk.length === 0) return;

    const csvContent = [
      columnNames.map(escapeCSVField).join(','),
      ...chunk.map(row => columnNames.map(col => escapeCSVField(row[col] || '')).join(','))
    ].join('\n');

    const outputFileName = `${countryName}-${chunkNum}.csv`;
    const outputPath = join(__dirname, outputFileName);
    await writeFile(outputPath, csvContent);
    console.log(`Created ${outputFileName} with ${chunk.length} rows`);
    createdFiles.push(outputFileName);
  };

  let chunkNumber = 1;
  let currentIndex = 0;

  while (currentIndex < allData.length) {
    const chunk = allData.slice(currentIndex, currentIndex + CHUNK_SIZE);
    await writeChunk(chunk, chunkNumber);
    currentIndex += CHUNK_SIZE;
    chunkNumber++;
  }

  console.log(`Processed ${countryName}: ${allData.length} total rows in ${chunkNumber - 1} chunks`);
}


async function updateMetaCSV(metaFilePath, newFiles) {
  const metaContent = [
    'filename',
    ...newFiles.sort()
  ].join('\n');

  await writeFile(metaFilePath, metaContent);
  console.log(`\nUpdated ${basename(metaFilePath)} with ${newFiles.length} files`);
}

async function main() {
  const metaFileName = 'cities-meta.csv';
  const metaFilePath = join(__dirname, metaFileName);
  const metaFiles = await parseMetaCSV(metaFilePath);

  const countryGroups = groupFilesByCountry(metaFiles);
  const countryNames = Object.keys(countryGroups);
  const createdFiles = [];

  console.log(`Found ${countryNames.length} countries with ${metaFiles.length} total files...`);

  for (const countryName of countryNames) {
    const countryFiles = countryGroups[countryName];
    try {
      await processCountryInChunks(countryName, countryFiles, createdFiles);
    } catch (error) {
      console.error(`Error processing ${countryName}:`, error.message);
    }
  }

  await updateMetaCSV(metaFilePath, createdFiles);
  console.log('\nAll countries processed!');
}

main();
