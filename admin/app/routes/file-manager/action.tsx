import type { Route } from "./+types/file-manager";
import path from "path";
import fs from "fs/promises";

function isValidFileName(name: string): boolean {
  const forbiddenPatterns = [
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

export async function action({ request }: Route.ActionArgs) {
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
  }
  
  return { success: false, error: "Invalid action" };
}