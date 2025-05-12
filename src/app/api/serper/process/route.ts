import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase/supabaseAdmin';
import { runSerper } from '../../../../lib/services/serper/index';

export async function POST(request: NextRequest) {
    let resultId: string | undefined;
    
    try {
        const body = await request.json();
        if (!body || !body.resultId || !body.rows) {
            return NextResponse.json(
                { error: 'Missing required fields: resultId and rows' },
                { status: 400 }
            );
        }

        resultId = body.resultId;
        const { rows } = body;

        void (async () => {
            try {
                const { results, creditsUsed } = await runSerper(rows);
                
                const allKeys = new Set([
                    'query', 'city', 'zip', 'search_term', 'page', 'is_valid', 'maps_url'
                ]);

                results.forEach(result => {
                    Object.keys(result).forEach(key => allKeys.add(key));
                });

                const headers = [
                    'query', 'city', 'zip', 'search_term', 'page', 'is_valid', 'maps_url'
                ].concat(Array.from(allKeys)
                    .filter(k => !['query', 'city', 'zip', 'search_term', 'page', 'is_valid', 'maps_url'].includes(k))
                    .sort()
                );

                const resultsHeader = headers.join(',') + '\n';
                const resultsRows = results.map(result => 
                    headers.map(header => {
                        const value = result[header] ?? '';
                        return `"${String(value).replace(/"/g, '""')}"`;
                    }).join(',')
                ).join('\n');
                
                const csvContent = resultsHeader + resultsRows;

                const fileSize = new TextEncoder().encode(csvContent).length;

                const fileName = `serper-results/${resultId}.csv`;
                const { error: uploadError } = await supabaseAdmin.storage
                    .from('serper-results')
                    .upload(fileName, csvContent, {
                        contentType: 'text/csv',
                        upsert: true
                    });

                if (uploadError) {
                    throw new Error(`Error uploading file: ${uploadError.message}`);
                }

                const { data: { publicUrl } } = supabaseAdmin.storage
                    .from('serper-results')
                    .getPublicUrl(fileName);

                const { error: updateError } = await supabaseAdmin
                    .from('serper_results')
                    .update({
                        status: 'DONE',
                        file_url: publicUrl,
                        result_count: results.length,
                        file_size: fileSize,
                        credits_used: creditsUsed,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', resultId);

                if (updateError) {
                    throw new Error(`Error updating record: ${updateError.message}`);
                }

                const { data: serperResult, error: fetchUserError } = await supabaseAdmin
                    .from('serper_results')
                    .select('user_id')
                    .eq('id', resultId)
                    .single();

                if (!fetchUserError && serperResult?.user_id) {
                    const { data: userData, error: userError } = await supabaseAdmin
                        .from('users')
                        .select('tokens_used')
                        .eq('id', serperResult.user_id)
                        .single();

                    if (!userError && userData) {
                        const currentTokens = userData.tokens_used || 0;
                        const newTokens = currentTokens + results.length;

                        await supabaseAdmin
                            .from('users')
                            .update({ tokens_used: newTokens })
                            .eq('id', serperResult.user_id);
                    }
                }
            } catch (error) {
                console.error('Error processing Serper queries:', error);
                
                if (resultId) {
                    await supabaseAdmin
                        .from('serper_results')
                        .update({
                            status: 'ERROR',
                            error_message: error instanceof Error ? error.message : 'Unknown error',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', resultId);
                }
            }
        })();

        process.on('SIGTERM', async () => {
            console.log('Received SIGTERM signal');
            if (resultId) {
                try {
                    await supabaseAdmin
                        .from('serper_results')
                        .update({
                            status: 'ERROR',
                            error_message: 'Process terminated',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', resultId);
                } catch (error) {
                    console.error('Error updating status on termination:', error);
                }
            }
            process.exit(0);
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error starting Serper process:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
} 