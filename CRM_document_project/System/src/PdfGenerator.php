<?php
namespace Grm;

use Dompdf\Dompdf;
use Dompdf\Options;

class PdfGenerator {
    public static function generate($html, $filename) {
        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', true); // For loading logos/images

        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html);
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();
        
        $output = $dompdf->output();
        $path = __DIR__ . '/../public/uploads/' . $filename;
        file_put_contents($path, $output);
        
        return $filename;
    }
}
