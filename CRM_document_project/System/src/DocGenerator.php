<?php
namespace Grm;

use PhpOffice\PhpWord\TemplateProcessor;

class DocGenerator {
    public static function generate($templateName, $data, $outputName) {
        $templatePath = __DIR__ . '/../templates/' . $templateName;
        $outputPath = __DIR__ . '/../public/uploads/' . $outputName . '.docx';

        if (!file_exists($templatePath)) {
            throw new \Exception("Template not found: " . $templatePath);
        }

        $templateProcessor = new TemplateProcessor($templatePath);

        // Map all post data to template variables
        foreach ($data as $key => $value) {
            $templateProcessor->setValue($key, $value);
        }

        $templateProcessor->saveAs($outputPath);
        return $outputName . '.docx';
    }
}
