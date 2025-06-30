import type { Route } from "./+types/file-manager";
import path from "path";
import fs from "fs/promises";

function isValidFileName(name: string): boolean {
  const forbiddenPatterns = [
    /^\/$/,        // "/"
    /^\./,         // "."
    /^\.\/$/,      // "./"
    /^\.\.\/$/,    // "../"
    /^\.\.$/,      // ".."
    /^\.$/,        // "."
    /\/\.\.\//,    // "/../"
    /\/\.\//,      // "/./"
    /\.\./,        // ".." anywhere in the name
    /^\.\/$/,      // "./"
    /^\.\.\/$/,    // "../"
    /^\.\.$/,      // ".."
    /^\.$/,        // "."
    /\/\.\.\//,    // "/../"
    /\/\.\//,      // "/./"
    /\.\./,        // ".." anywhere in the name
    /\/\//,        // "//" (double slash)
  ];
  
  return !forbiddenPatterns.some(pattern => pattern.test(name));
}

export function getValidationError(name: string): string | null {
  if (!name.trim()) {
    return "Name cannot be empty";
  }
  
  if (!isValidFileName(name)) {
    return "Name cannot contain './', '../', or other path traversal characters";
  }
  
  // Check for other invalid characters
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(name)) {
    return "Name contains invalid characters";
  }
  
  return null;
}

async function createDirectory(dirPath: string): Promise<boolean> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    console.error("Error creating directory:", error);
    return false;
  }
}

async function deleteFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await fs.rmdir(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
    return true;
  } catch (error) {
    console.error("Error deleting file:", error);
    return false;
  }
}

async function uploadFile(filePath: string, file: any): Promise<boolean> {
  try {
    // Debug: Log the file object to see what we're working with
    console.log('File object type:', typeof file);
    console.log('File object:', file);
    console.log('File object keys:', Object.keys(file || {}));
    console.log('File object prototype:', Object.getPrototypeOf(file));
    
    const destPath = path.join(filePath, file.name);
    console.log('Destination path:', destPath);
    console.log('File path:', filePath);
    console.log('File name:', file.name);

    // Ensure the destination directory exists
    const destDir = path.dirname(destPath);
    console.log('Destination directory:', destDir);
    await fs.mkdir(destDir, { recursive: true });
    console.log('Directory created/verified:', destDir);

    // In Node.js/Remix, the file from formData is a different type
    // We need to handle it as a stream or buffer
    if (file && typeof file.arrayBuffer === 'function') {
      // Browser File object (shouldn't happen in Node.js)
      console.log('Using arrayBuffer method');
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      console.log('Buffer size:', buffer.length);
      await fs.writeFile(destPath, buffer);
      console.log('File written successfully to:', destPath);
    } else if (file && file.stream) {
      // Node.js file object with stream
      console.log('Using stream method');
      const stream = file.stream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(destPath, buffer);
      console.log('File written successfully to:', destPath);
    } else if (file && file.buffer) {
      // Node.js file object with buffer
      console.log('Using buffer property');
      await fs.writeFile(destPath, file.buffer);
      console.log('File written successfully to:', destPath);
    } else {
      console.log('File object does not match any expected type');
      throw new Error('Unsupported file type');
    }
    
    console.log('uploaded file', destPath);
    return true;
  } catch (error) {
    console.error("Error uploading file:", error);
    return false;
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    const formData = await request.formData();
    const intent = formData.get('intent') as string;
    if (intent === 'createFolder') {
      const folderName = formData.get('folderName') as string;
      const currentPath = formData.get('currentPath') as string;
      
      // Validate folder name
      const validationError = getValidationError(folderName);
      if (validationError) {
        return { success: false, error: validationError };
      }
      
      const newPath = path.join(currentPath, folderName);
      const success = await createDirectory(newPath);
      
      if (success) {
        return { success: true };
      } else {
        return { success: false, error: "Failed to create folder" };
      }
    } else if (intent === 'deleteFile') {
      const filePath = formData.get('filePath') as string;
      const success = await deleteFile(filePath);
      return { success };
    } else if (intent === 'uploadFile') {
      const filePath = formData.get('filePath') as string;
      const file = formData.get('file');
      if (!file) {
        return { success: false, error: "No file provided" };
      }
      const success = await uploadFile(filePath, file);
      return { success };
    }

    return { success: false, error: "Invalid action" };
  } catch (error) {
    console.error("Error in action:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}